package main

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/gin-gonic/gin"
	"gopkg.in/yaml.v3"
)

// Configuration for R2/S3 CDN
type CDNConfig struct {
	Endpoint        string
	Region          string
	Bucket          string
	AccessKeyID     string
	SecretAccessKey string
	BaseURL         string // Public CDN URL base
	S3Client        *s3.Client
}

// Skill metadata from SKILL.md frontmatter
type SkillFrontmatter struct {
	Name        string `yaml:"name"`
	Description string `yaml:"description"`
	License     string `yaml:"license"`
}

// Skill metadata returned by API (detail view)
type SkillMeta struct {
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	Description      string   `json:"description"`
	Category         string   `json:"category,omitempty"`
	Version          string   `json:"version"`
	Author           string   `json:"author,omitempty"`
	Tags             []string `json:"tags"`
	SourceURL        string   `json:"source_url,omitempty"`
	Files            []string `json:"files,omitempty"`
	DownloadURL      string   `json:"download_url,omitempty"`
	Content          string   `json:"content,omitempty"`
	CompatibleAgents []string `json:"compatible_agents"`
	DownloadCount    int64    `json:"download_count"` // Number of downloads from skills.sh
}

// Skill metadata for list view (no content, files, download_url)
type SkillListItem struct {
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	Description      string   `json:"description"`
	Category         string   `json:"category,omitempty"`
	Version          string   `json:"version"`
	Author           string   `json:"author,omitempty"`
	Tags             []string `json:"tags"`
	SourceURL        string   `json:"source_url,omitempty"`
	CompatibleAgents []string `json:"compatible_agents"`
	DownloadCount    int64    `json:"download_count"` // Number of downloads from skills.sh
}

// Skill detail with full content
type SkillDetail struct {
	SkillMeta
}

// Skill category
type SkillCategory struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
}

// Server state
type Server struct {
	skillsDir          string
	cdnConfig          *CDNConfig
	skills             []SkillMeta
	categories         map[string]string
	downloadCounts     map[string]int64 // skill_id -> download_count from skills.sh
	skillsShData       *SkillsShData    // cached skills.sh data
	skillsShDataPath   string           // path to cache file
	githubSkillsData   *GitHubSkillData // cached GitHub skills data
	githubDataPath     string           // path to GitHub cache file
	githubScraper      *GitHubScraper   // GitHub API scraper
}

func main() {
	// Configuration
	skillsDir := os.Getenv("SKILLS_DIR")
	if skillsDir == "" {
		// Default to the main project directory
		skillsDir = "../awesome-claude-skills-temp"
	}

	cdnConfig := &CDNConfig{
		Endpoint:        os.Getenv("CDN_ENDPOINT"),
		Region:          os.Getenv("CDN_REGION"),
		Bucket:          os.Getenv("CDN_BUCKET"),
		AccessKeyID:     os.Getenv("CDN_ACCESS_KEY_ID"),
		SecretAccessKey: os.Getenv("CDN_SECRET_ACCESS_KEY"),
		BaseURL:         os.Getenv("CDN_BASE_URL"),
	}

	// Initialize S3 client if CDN is configured
	if cdnConfig.Endpoint != "" && cdnConfig.AccessKeyID != "" && cdnConfig.SecretAccessKey != "" {
		awsCfg, err := config.LoadDefaultConfig(context.Background(),
			config.WithRegion(cdnConfig.Region),
			config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
				cdnConfig.AccessKeyID,
				cdnConfig.SecretAccessKey,
				"",
			)),
		)
		if err != nil {
			fmt.Printf("Warning: Failed to initialize S3 client: %v\n", err)
		} else {
			cdnConfig.S3Client = s3.NewFromConfig(awsCfg, func(o *s3.Options) {
				o.BaseEndpoint = aws.String(cdnConfig.Endpoint)
				o.UsePathStyle = true // Required for R2
			})
			fmt.Println("S3 client initialized for CDN")
		}
	}

	server := &Server{
		skillsDir:        skillsDir,
		cdnConfig:        cdnConfig,
		categories:       make(map[string]string),
		downloadCounts:   make(map[string]int64),
		skillsShDataPath: "skills_sh_data.json",
		githubDataPath:   "github_skills_data.json",
		githubScraper:    NewGitHubScraper(),
	}

	// Load skills.sh data if available
	if err := server.loadSkillsShData(); err != nil {
		fmt.Printf("Warning: failed to load skills.sh data: %v\n", err)
	}

	// Load GitHub skills data if available
	if err := server.loadGitHubSkillsData(); err != nil {
		fmt.Printf("Warning: failed to load GitHub skills data: %v\n", err)
	}

	// Initialize skills
	if err := server.loadSkills(); err != nil {
		fmt.Printf("Error loading skills: %v\n", err)
		os.Exit(1)
	}

	// Start periodic sync if configured
	syncInterval := os.Getenv("SYNC_INTERVAL")
	if syncInterval != "" {
		duration, err := time.ParseDuration(syncInterval)
		if err != nil {
			fmt.Printf("Warning: invalid SYNC_INTERVAL '%s', using default 6h\n", syncInterval)
			duration = 6 * time.Hour
		}
		server.startPeriodicSync(duration)
	}

	// Setup Gin router
	r := gin.Default()

	// CORS middleware
	r.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	})

	// API routes
	api := r.Group("/api")
	{
		api.GET("/skills", server.listSkills)
		api.GET("/skills/:id", server.getSkill)
		api.GET("/categories", server.listCategories)
		api.GET("/download/:id", server.downloadSkill)
		api.GET("/download/:id/files", server.downloadSkillFiles)
		api.GET("/download/:id/file/*filepath", server.downloadSkillFile)
		api.POST("/sync", server.syncSkillsSh)       // Sync from skills.sh
		api.POST("/sync/github", server.syncGitHub)  // Sync from GitHub
		api.POST("/sync/all", server.syncAll)        // Sync from all sources
		api.GET("/sync/status", server.getSyncStatus)
	}

	// Health check
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	// Start server
	port := os.Getenv("PORT")
	if port == "" {
		port = "3101"
	}

	fmt.Printf("Skill Registry Server starting on port %s...\n", port)
	fmt.Printf("Skills directory: %s\n", skillsDir)
	fmt.Printf("Loaded %d skills from %d categories\n", len(server.skills), len(server.categories))
	r.Run(":" + port)
}

// Load skills from the skills directory
func (s *Server) loadSkills() error {
	entries, err := os.ReadDir(s.skillsDir)
	if err != nil {
		return fmt.Errorf("failed to read skills directory: %w", err)
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		// Skip .git directory
		if entry.Name() == ".git" {
			continue
		}

		skillDir := filepath.Join(s.skillsDir, entry.Name())
		skill, err := s.loadSkillFromDir(skillDir)
		if err != nil {
			fmt.Printf("Warning: failed to load skill from %s: %v\n", skillDir, err)
			continue
		}

		// Generate CDN download URL
		if s.cdnConfig != nil && s.cdnConfig.BaseURL != "" {
			skill.DownloadURL = fmt.Sprintf("%s/%s.tar.gz", s.cdnConfig.BaseURL, skill.ID)
		} else {
			// Fallback to local download
			skill.DownloadURL = fmt.Sprintf("/api/download/%s", skill.ID)
		}

		s.skills = append(s.skills, skill)

		// Track categories
		if skill.Category != "" {
			s.categories[skill.Category] = skill.Category
		}
	}

	return nil
}

// Load a single skill from its directory
func (s *Server) loadSkillFromDir(dir string) (SkillMeta, error) {
	skillID := filepath.Base(dir)

	// Read SKILL.md
	skillMDPath := filepath.Join(dir, "SKILL.md")
	skillMeta, content, err := parseSkillMarkdown(skillMDPath)
	if err != nil {
		return SkillMeta{}, err
	}

	// List all files in the skill directory
	files, err := listSkillFiles(dir)
	if err != nil {
		return SkillMeta{}, err
	}

	return SkillMeta{
		ID:               skillID,
		Name:             skillMeta.Name,
		Description:      skillMeta.Description,
		Category:         getCategoryFromName(skillMeta.Name),
		Version:          "1.0.0",
		Author:           "ComposioHQ",
		Tags:             []string{skillID},
		SourceURL:        fmt.Sprintf("https://github.com/ComposioHQ/awesome-claude-skills/tree/master/%s", skillID),
		Files:            files,
		Content:          content,
		CompatibleAgents: []string{"claude-code"},
	}, nil
}

// Parse SKILL.md frontmatter
func parseSkillMarkdown(path string) (SkillFrontmatter, string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return SkillFrontmatter{}, "", err
	}

	content := string(data)

	// Check for YAML frontmatter
	if !strings.HasPrefix(content, "---") {
		// No frontmatter, use filename as name
		name := filepath.Base(filepath.Dir(path))
		return SkillFrontmatter{
			Name:        name,
			Description: "No description available",
		}, content, nil
	}

	// Parse frontmatter
	parts := strings.SplitN(content, "---", 3)
	if len(parts) < 3 {
		name := filepath.Base(filepath.Dir(path))
		return SkillFrontmatter{
			Name:        name,
			Description: "No description available",
		}, content, nil
	}

	var fm SkillFrontmatter
	if err := yaml.Unmarshal([]byte(parts[1]), &fm); err != nil {
		return SkillFrontmatter{}, "", err
	}

	return fm, content, nil
}

// List all files in a skill directory
func listSkillFiles(dir string) ([]string, error) {
	var files []string

	err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		// Skip the root directory itself
		if path == dir {
			return nil
		}

		// Expose files only; directory entries cannot be downloaded as files.
		if info.IsDir() {
			return nil
		}

		// Get relative path
		relPath, err := filepath.Rel(dir, path)
		if err != nil {
			return err
		}

		// Use stable slash separator for API responses across OSes.
		relPath = filepath.ToSlash(relPath)
		files = append(files, relPath)
		return nil
	})

	return files, err
}

// Get category from skill name (simple heuristic)
func getCategoryFromName(name string) string {
	nameLower := strings.ToLower(name)

	categoryKeywords := map[string][]string{
		"development":   {"builder", "code", "dev", "mcp", "api", "test"},
		"design":        {"design", "canvas", "ui", "theme"},
		"documentation": {"doc", "changelog", "readme"},
		"productivity":  {"organizer", "file", "manager"},
		"media":         {"image", "video", "media"},
		"content":       {"content", "research", "writer"},
		"business":      {"lead", "research", "business"},
	}

	for category, keywords := range categoryKeywords {
		for _, kw := range keywords {
			if strings.Contains(nameLower, kw) {
				return category
			}
		}
	}

	return "general"
}

// API Handlers

func (s *Server) listSkills(c *gin.Context) {
	search := c.Query("search")
	category := c.Query("category")
	sortBy := c.Query("sort")      // "downloads", "name", "recent"
	limitStr := c.Query("limit")   // pagination
	offsetStr := c.Query("offset") // pagination
	source := c.Query("source")    // "local", "github", "all" (default: all)

	var result []SkillListItem
	seenIDs := make(map[string]bool)

	// Add local skills
	if source == "" || source == "all" || source == "local" {
		for _, skill := range s.skills {
			// Filter by search
			if search != "" {
				searchLower := strings.ToLower(search)
				if !strings.Contains(strings.ToLower(skill.Name), searchLower) &&
					!strings.Contains(strings.ToLower(skill.Description), searchLower) {
					continue
				}
			}

			// Filter by category
			if category != "" && skill.Category != category {
				continue
			}

			seenIDs[skill.ID] = true

			// Convert to list item (exclude content, files, download_url)
			result = append(result, SkillListItem{
				ID:               skill.ID,
				Name:             skill.Name,
				Description:      skill.Description,
				Category:         skill.Category,
				Version:          skill.Version,
				Author:           skill.Author,
				Tags:             skill.Tags,
				SourceURL:        skill.SourceURL,
				CompatibleAgents: skill.CompatibleAgents,
				DownloadCount:    skill.DownloadCount,
			})
		}
	}

	// Add GitHub skills if available
	if (source == "" || source == "all" || source == "github") && s.githubSkillsData != nil {
		for _, skill := range s.githubSkillsData.Skills {
			// Skip if already seen from local
			if seenIDs[skill.ID] {
				continue
			}

			// Filter by search
			if search != "" {
				searchLower := strings.ToLower(search)
				if !strings.Contains(strings.ToLower(skill.Name), searchLower) &&
					!strings.Contains(strings.ToLower(skill.Description), searchLower) {
					continue
				}
			}

			// Get category
			skillCategory := getCategoryFromName(skill.Name)

			// Filter by category
			if category != "" && skillCategory != category {
				continue
			}

			seenIDs[skill.ID] = true

			result = append(result, SkillListItem{
				ID:               skill.ID,
				Name:             skill.Name,
				Description:      skill.Description,
				Category:         skillCategory,
				Version:          "1.0.0",
				Author:           skill.Owner,
				Tags:             skill.Topics,
				SourceURL:        skill.SourceURL,
				CompatibleAgents: []string{"claude-code"},
				DownloadCount:    skill.DownloadCount,
			})
		}
	}

	// Sort results
	switch sortBy {
	case "downloads":
		// Sort by download count descending
		for i := 0; i < len(result)-1; i++ {
			for j := i + 1; j < len(result); j++ {
				if result[j].DownloadCount > result[i].DownloadCount {
					result[i], result[j] = result[j], result[i]
				}
			}
		}
	case "name":
		// Sort by name ascending
		for i := 0; i < len(result)-1; i++ {
			for j := i + 1; j < len(result); j++ {
				if strings.ToLower(result[i].Name) > strings.ToLower(result[j].Name) {
					result[i], result[j] = result[j], result[i]
				}
			}
		}
	default:
		// Default: sort by downloads
		for i := 0; i < len(result)-1; i++ {
			for j := i + 1; j < len(result); j++ {
				if result[j].DownloadCount > result[i].DownloadCount {
					result[i], result[j] = result[j], result[i]
				}
			}
		}
	}

	// Apply pagination
	if limitStr != "" {
		limit, err := strconv.Atoi(limitStr)
		if err == nil && limit > 0 {
			offset := 0
			if offsetStr != "" {
				offset, _ = strconv.Atoi(offsetStr)
			}

			if offset < len(result) {
				end := offset + limit
				if end > len(result) {
					end = len(result)
				}
				result = result[offset:end]
			} else {
				result = []SkillListItem{}
			}
		}
	}

	c.JSON(http.StatusOK, result)
}

func (s *Server) getSkill(c *gin.Context) {
	id := c.Param("id")

	for _, skill := range s.skills {
		if skill.ID == id {
			// Return skill without content in list view, but with content in detail view
			detail := SkillDetail{
				SkillMeta: skill,
			}
			c.JSON(http.StatusOK, detail)
			return
		}
	}

	c.JSON(http.StatusNotFound, gin.H{"error": "Skill not found"})
}

func (s *Server) listCategories(c *gin.Context) {
	var categories []SkillCategory

	// Add predefined categories
	catMap := map[string]string{
		"development":   "Development and coding skills",
		"design":        "Design and visual skills",
		"documentation": "Documentation and content skills",
		"productivity":  "Productivity and organization skills",
		"media":         "Media and image processing",
		"content":       "Content creation and research",
		"business":      "Business and sales skills",
		"general":       "General purpose skills",
	}

	for id, desc := range catMap {
		categories = append(categories, SkillCategory{
			ID:          id,
			Name:        strings.Title(id),
			Description: desc,
		})
	}

	c.JSON(http.StatusOK, categories)
}

func (s *Server) downloadSkill(c *gin.Context) {
	id := c.Param("id")

	// Find the skill
	skillDir := filepath.Join(s.skillsDir, id)
	if _, err := os.Stat(skillDir); os.IsNotExist(err) {
		c.JSON(http.StatusNotFound, gin.H{"error": "Skill not found"})
		return
	}

	// Check if S3 client is configured for pre-signed URLs
	if s.cdnConfig != nil && s.cdnConfig.S3Client != nil && s.cdnConfig.Bucket != "" {
		// Generate pre-signed URL for the skill tarball
		key := fmt.Sprintf("skills/%s.tar.gz", id)
		presignedURL, err := s.generatePresignedURL(key)
		if err == nil {
			c.JSON(http.StatusOK, gin.H{
				"skill_id":        id,
				"cdn_url":         presignedURL,
				"files":           s.getSkillFiles(id),
				"download_method": "presigned",
			})
			return
		}
		// Fall through to CDN redirect or local download
	}

	// Check if CDN URL is configured
	if s.cdnConfig != nil && s.cdnConfig.BaseURL != "" {
		// Return CDN redirect
		cdnURL := fmt.Sprintf("%s/%s.tar.gz", s.cdnConfig.BaseURL, id)
		c.JSON(http.StatusOK, gin.H{
			"skill_id":        id,
			"cdn_url":         cdnURL,
			"files":           s.getSkillFiles(id),
			"download_method": "redirect",
		})
		return
	}

	// Create tar.gz on the fly
	c.Header("Content-Type", "application/gzip")
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%s.tar.gz", id))

	if err := s.createTarGz(c.Writer, skillDir); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	}
}

// Generate pre-signed URL for S3/R2
func (s *Server) generatePresignedURL(key string) (string, error) {
	if s.cdnConfig.S3Client == nil {
		return "", fmt.Errorf("S3 client not initialized")
	}

	// Set expiration time (1 hour)
	expiration := time.Hour

	// Generate pre-signed URL
	presignClient := s3.NewPresignClient(s.cdnConfig.S3Client)
	request, err := presignClient.PresignGetObject(context.Background(), &s3.GetObjectInput{
		Bucket: aws.String(s.cdnConfig.Bucket),
		Key:    aws.String(key),
	}, func(opts *s3.PresignOptions) {
		opts.Expires = expiration
	})

	if err != nil {
		return "", fmt.Errorf("failed to generate presigned URL: %w", err)
	}

	return request.URL, nil
}

func (s *Server) downloadSkillFiles(c *gin.Context) {
	id := c.Param("id")

	files := s.getSkillFiles(id)
	if files == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Skill not found"})
		return
	}

	// Generate download URLs for each file
	type FileInfo struct {
		Path     string `json:"path"`
		Download string `json:"download_url"`
	}
	var fileList []FileInfo
	for _, f := range files {
		downloadURL := fmt.Sprintf("%s/api/download/%s/file/%s", baseURL(c), id, url.PathEscape(f))

		// If S3 is configured, generate pre-signed URLs for each file
		if s.cdnConfig != nil && s.cdnConfig.S3Client != nil && s.cdnConfig.Bucket != "" {
			key := fmt.Sprintf("skills/%s/%s", id, f)
			presignedURL, err := s.generatePresignedURL(key)
			if err == nil {
				downloadURL = presignedURL
			}
		}

		fileList = append(fileList, FileInfo{Path: f, Download: downloadURL})
	}

	c.JSON(http.StatusOK, gin.H{
		"skill_id": id,
		"files":    fileList,
	})
}

// Download a single file from a skill
func (s *Server) downloadSkillFile(c *gin.Context) {
	id := c.Param("id")
	filePath := strings.TrimPrefix(c.Param("filepath"), "/")

	// Decode the filepath
	decodedPath, err := url.PathUnescape(filePath)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid file path encoding"})
		return
	}

	// Build the full file path
	skillDir := filepath.Join(s.skillsDir, id)
	fullPath := filepath.Join(skillDir, decodedPath)

	// Security check: ensure the path is within the skill directory
	absSkillDir, _ := filepath.Abs(skillDir)
	absFilePath, _ := filepath.Abs(fullPath)
	if !strings.HasPrefix(absFilePath, absSkillDir) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Invalid file path"})
		return
	}

	// Check if file exists
	if _, err := os.Stat(fullPath); os.IsNotExist(err) {
		c.JSON(http.StatusNotFound, gin.H{"error": "File not found"})
		return
	}

	// Serve the file
	c.Header("Content-Type", "application/octet-stream")
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%s", filepath.Base(decodedPath)))
	c.File(fullPath)
}

func baseURL(c *gin.Context) string {
	scheme := "http"
	if c.Request.TLS != nil {
		scheme = "https"
	} else if forwardedProto := c.GetHeader("X-Forwarded-Proto"); forwardedProto != "" {
		scheme = forwardedProto
	}
	return fmt.Sprintf("%s://%s", scheme, c.Request.Host)
}

func (s *Server) getSkillFiles(skillID string) []string {
	for _, skill := range s.skills {
		if skill.ID == skillID {
			return skill.Files
		}
	}
	return nil
}

// Create tar.gz from directory
func (s *Server) createTarGz(w io.Writer, dir string) error {
	gw := gzip.NewWriter(w)
	defer gw.Close()
	tw := tar.NewWriter(gw)
	defer tw.Close()

	return filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		// Get relative path
		relPath, err := filepath.Rel(filepath.Dir(dir), path)
		if err != nil {
			return err
		}

		// Skip the root directory itself
		if relPath == "." {
			return nil
		}

		header, err := tar.FileInfoHeader(info, relPath)
		if err != nil {
			return err
		}
		header.Name = relPath

		if err := tw.WriteHeader(header); err != nil {
			return err
		}

		if !info.IsDir() {
			data, err := os.Open(path)
			if err != nil {
				return err
			}
			defer data.Close()

			if _, err := io.Copy(tw, data); err != nil {
				return err
			}
		}

		return nil
	})
}

// loadSkillsShData loads cached skills.sh data from file
func (s *Server) loadSkillsShData() error {
	data, err := os.ReadFile(s.skillsShDataPath)
	if err != nil {
		return err
	}

	var skillsShData SkillsShData
	if err := json.Unmarshal(data, &skillsShData); err != nil {
		return err
	}

	s.skillsShData = &skillsShData

	// Build download counts map
	s.downloadCounts = make(map[string]int64)
	for _, skill := range skillsShData.Skills {
		// Map skill ID patterns
		s.downloadCounts[skill.ID] = skill.DownloadCount
		// Also map by skill name for local matching
		s.downloadCounts[skill.Name] = skill.DownloadCount
	}

	fmt.Printf("Loaded %d skills.sh entries\n", len(skillsShData.Skills))
	return nil
}

// saveSkillsShData saves skills.sh data to cache file
func (s *Server) saveSkillsShData() error {
	if s.skillsShData == nil {
		return nil
	}

	data, err := json.MarshalIndent(s.skillsShData, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(s.skillsShDataPath, data, 0644)
}

// syncSkillsSh syncs skills data from skills.sh
func (s *Server) syncSkillsSh(c *gin.Context) {
	fmt.Println("Starting skills.sh sync...")

	data, err := ScrapeSkillsSh()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Failed to scrape skills.sh",
			"details": err.Error(),
		})
		return
	}

	s.skillsShData = data

	// Build download counts map
	s.downloadCounts = make(map[string]int64)
	for _, skill := range data.Skills {
		s.downloadCounts[skill.ID] = skill.DownloadCount
		s.downloadCounts[skill.Name] = skill.DownloadCount
	}

	// Update existing skills with download counts
	for i := range s.skills {
		if count, ok := s.downloadCounts[s.skills[i].ID]; ok {
			s.skills[i].DownloadCount = count
		} else if count, ok := s.downloadCounts[s.skills[i].Name]; ok {
			s.skills[i].DownloadCount = count
		}
	}

	// Save to cache
	if err := s.saveSkillsShData(); err != nil {
		fmt.Printf("Warning: failed to save skills.sh data: %v\n", err)
	}

	c.JSON(http.StatusOK, gin.H{
		"status":         "success",
		"total_skills":   data.TotalSkills,
		"total_installs": data.TotalInstalls,
		"generated_at":   data.GeneratedAt,
	})
}

// getSyncStatus returns the current sync status
func (s *Server) getSyncStatus(c *gin.Context) {
	status := gin.H{
		"skills_sh": gin.H{
			"has_data": s.skillsShData != nil,
		},
		"github": gin.H{
			"has_data": s.githubSkillsData != nil,
		},
		"local_skills": len(s.skills),
	}

	if s.skillsShData != nil {
		status["skills_sh"] = gin.H{
			"has_data":       true,
			"total_skills":   s.skillsShData.TotalSkills,
			"total_installs": s.skillsShData.TotalInstalls,
			"generated_at":   s.skillsShData.GeneratedAt,
		}
	}

	if s.githubSkillsData != nil {
		status["github"] = gin.H{
			"has_data":     true,
			"total_skills": s.githubSkillsData.TotalSkills,
			"generated_at": s.githubSkillsData.GeneratedAt,
		}
	}

	c.JSON(http.StatusOK, status)
}

// startPeriodicSync starts a background goroutine to sync data periodically
func (s *Server) startPeriodicSync(interval time.Duration) {
	fmt.Printf("Starting periodic sync every %v\n", interval)

	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for range ticker.C {
			fmt.Println("Running scheduled sync (all sources)...")
			s.doFullSync()
		}
	}()
}

// doFullSync syncs from all sources: GitHub and skills.sh
func (s *Server) doFullSync() {
	ctx := context.Background()

	// 1. Sync from skills.sh for download counts
	fmt.Println("Step 1: Syncing from skills.sh...")
	shData, err := ScrapeSkillsShWithOptions(true)
	if err != nil {
		fmt.Printf("Warning: skills.sh sync failed: %v\n", err)
	} else {
		s.skillsShData = shData
		s.buildDownloadCountsMap()
		if err := s.saveSkillsShData(); err != nil {
			fmt.Printf("Warning: failed to save skills.sh data: %v\n", err)
		}
		fmt.Printf("  skills.sh: %d skills, %d total installs\n", shData.TotalSkills, shData.TotalInstalls)
	}

	// 2. Sync from GitHub for full skill discovery
	fmt.Println("Step 2: Syncing from GitHub...")
	githubData, err := s.githubScraper.SearchSkills(ctx)
	if err != nil {
		fmt.Printf("Warning: GitHub sync failed: %v\n", err)
	} else {
		// Merge download counts from skills.sh
		s.githubScraper.MergeWithSkillsSh(githubData, s.skillsShData)
		s.githubSkillsData = githubData
		if err := s.saveGitHubSkillsData(); err != nil {
			fmt.Printf("Warning: failed to save GitHub data: %v\n", err)
		}
		fmt.Printf("  GitHub: %d skills found\n", githubData.TotalSkills)
	}

	// 3. Update local skills with download counts
	s.updateSkillsDownloadCounts()

	fmt.Println("Full sync completed")
}

// buildDownloadCountsMap builds the download counts map from skills.sh data
func (s *Server) buildDownloadCountsMap() {
	s.downloadCounts = make(map[string]int64)
	if s.skillsShData == nil {
		return
	}
	for _, skill := range s.skillsShData.Skills {
		s.downloadCounts[skill.ID] = skill.DownloadCount
		s.downloadCounts[skill.Name] = skill.DownloadCount
	}
}

// updateSkillsDownloadCounts updates local skills with download counts
func (s *Server) updateSkillsDownloadCounts() {
	for i := range s.skills {
		if count, ok := s.downloadCounts[s.skills[i].ID]; ok {
			s.skills[i].DownloadCount = count
		} else if count, ok := s.downloadCounts[s.skills[i].Name]; ok {
			s.skills[i].DownloadCount = count
		}
	}
}

// loadGitHubSkillsData loads cached GitHub skills data from file
func (s *Server) loadGitHubSkillsData() error {
	data, err := ReadGitHubSkillsData(s.githubDataPath)
	if err != nil {
		return err
	}
	s.githubSkillsData = data
	fmt.Printf("Loaded %d GitHub skills\n", len(data.Skills))
	return nil
}

// saveGitHubSkillsData saves GitHub skills data to cache file
func (s *Server) saveGitHubSkillsData() error {
	if s.githubSkillsData == nil {
		return nil
	}
	return WriteGitHubSkillsData(s.githubSkillsData, s.githubDataPath)
}

// syncGitHub syncs skills data from GitHub
func (s *Server) syncGitHub(c *gin.Context) {
	fmt.Println("Starting GitHub sync...")
	ctx := c.Request.Context()

	data, err := s.githubScraper.SearchSkills(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Failed to search GitHub",
			"details": err.Error(),
		})
		return
	}

	// Merge with skills.sh download counts
	s.githubScraper.MergeWithSkillsSh(data, s.skillsShData)
	s.githubSkillsData = data

	// Save to cache
	if err := s.saveGitHubSkillsData(); err != nil {
		fmt.Printf("Warning: failed to save GitHub data: %v\n", err)
	}

	c.JSON(http.StatusOK, gin.H{
		"status":       "success",
		"total_skills": data.TotalSkills,
		"generated_at": data.GeneratedAt,
	})
}

// syncAll syncs from all sources
func (s *Server) syncAll(c *gin.Context) {
	fmt.Println("Starting full sync (all sources)...")

	go s.doFullSync()

	c.JSON(http.StatusOK, gin.H{
		"status":  "started",
		"message": "Full sync started in background",
	})
}
