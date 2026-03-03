package main

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
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

// Skill metadata returned by API
type SkillMeta struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Category    string   `json:"category,omitempty"`
	Version     string   `json:"version"`
	Author      string   `json:"author,omitempty"`
	Tags        []string `json:"tags"`
	SourceURL   string   `json:"source_url,omitempty"`
	Files       []string `json:"files,omitempty"`
	DownloadURL string   `json:"download_url,omitempty"`
	Content     string   `json:"content,omitempty"`
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
	skillsDir  string
	cdnConfig  *CDNConfig
	skills     []SkillMeta
	categories map[string]string
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
		skillsDir:  skillsDir,
		cdnConfig:  cdnConfig,
		categories: make(map[string]string),
	}

	// Initialize skills
	if err := server.loadSkills(); err != nil {
		fmt.Printf("Error loading skills: %v\n", err)
		os.Exit(1)
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
		ID:          skillID,
		Name:        skillMeta.Name,
		Description: skillMeta.Description,
		Category:    getCategoryFromName(skillMeta.Name),
		Version:     "1.0.0",
		Author:      "ComposioHQ",
		Tags:        []string{skillID},
		SourceURL:   fmt.Sprintf("https://github.com/ComposioHQ/awesome-claude-skills/tree/master/%s", skillID),
		Files:       files,
		Content:     content,
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

		// Get relative path
		relPath, err := filepath.Rel(dir, path)
		if err != nil {
			return err
		}

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

	var result []SkillMeta
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

		result = append(result, skill)
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

	if err := s.createTarGz(c, skillDir); err != nil {
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
		downloadURL := fmt.Sprintf("/api/download/%s/file/%s", id, strings.ReplaceAll(f, "/", "%2F"))

		// If S3 is configured, generate pre-signed URLs for each file
		if s.cdnConfig != nil && s.cdnConfig.S3Client != nil && s.cdnConfig.Bucket != "" {
			key := fmt.Sprintf("skills/%s/%s", id, f)
			presignedURL, err := s.generatePresignedURL(key)
			if err == nil {
				downloadURL = presignedURL
			}
		}

		fileList = append(fileList, FileInfo{
			Path:     f,
			Download: downloadURL,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"skill_id": id,
		"files":    fileList,
	})
}

// Download a single file from a skill
func (s *Server) downloadSkillFile(c *gin.Context) {
	id := c.Param("id")
	filePath := c.Param("filepath")

	// Decode the filepath
	decodedPath := strings.ReplaceAll(filePath, "%2F", "/")

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
