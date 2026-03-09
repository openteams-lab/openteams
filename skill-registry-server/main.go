package main

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
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
	Name             string   `yaml:"name"`
	Description      string   `yaml:"description"`
	License          string   `yaml:"license"`
	Author           string   `yaml:"author"`
	Category         string   `yaml:"category"`
	Tags             []string `yaml:"tags"`
	CompatibleAgents []string `yaml:"compatible_agents"`
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
	DownloadCount    int64    `json:"download_count"`
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
	DownloadCount    int64    `json:"download_count"`
}

// Skill detail with full content
type SkillDetail struct {
	SkillMeta
}

type SkillsDataFile struct {
	GeneratedAt string          `json:"generated_at"`
	TotalSkills int             `json:"total_skills"`
	Categories  []string        `json:"categories"`
	Skills      []SkillListItem `json:"skills"`
}

// Skill category
type SkillCategory struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
}

// Server state
type Server struct {
	skillsDir      string
	skillsDataPath string
	cdnConfig      *CDNConfig
	skills         []SkillMeta
	skillsData     SkillsDataFile
	skillPaths     map[string]string
	categories     map[string]string
}

func main() {
	// Configuration
	skillsDir := os.Getenv("SKILLS_DIR")
	if skillsDir == "" {
		skillsDir = filepath.Join("data", "skills")
	}
	skillsDataPath := os.Getenv("SKILLS_DATA_PATH")
	if skillsDataPath == "" {
		skillsDataPath = "skills_data.json"
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
		skillsDir:      skillsDir,
		skillsDataPath: skillsDataPath,
		cdnConfig:      cdnConfig,
		skillPaths:     make(map[string]string),
		categories:     make(map[string]string),
	}

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
		server.startPeriodicReload(duration)
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
		api.POST("/sync", server.syncLocalSkills)
		api.POST("/sync/all", server.syncAll)
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
	skillDirs, err := discoverSkillDirs(s.skillsDir)
	if err != nil {
		return fmt.Errorf("failed to discover skills: %w", err)
	}

	var skills []SkillMeta
	skillPaths := make(map[string]string)
	categories := make(map[string]string)
	for _, skillDir := range skillDirs {
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

		skills = append(skills, skill)
		skillPaths[skill.ID] = skillDir

		// Track categories
		if skill.Category != "" {
			categories[skill.Category] = skill.Category
		}
	}

	skillsData := buildSkillsDataFile(skills, categories)
	if err := s.writeSkillsDataFile(skillsData); err != nil {
		return fmt.Errorf("failed to write skills data file: %w", err)
	}
	loadedSkillsData, err := s.readSkillsDataFile()
	if err != nil {
		return fmt.Errorf("failed to read skills data file: %w", err)
	}

	s.skills = skills
	s.skillsData = loadedSkillsData
	s.skillPaths = skillPaths
	s.categories = categories
	return nil
}

// Load a single skill from its directory
func (s *Server) loadSkillFromDir(dir string) (SkillMeta, error) {
	// Read SKILL.md
	skillMDPath := filepath.Join(dir, "SKILL.md")
	skillID, err := s.buildSkillID(skillMDPath)
	if err != nil {
		return SkillMeta{}, err
	}
	skillMeta, content, err := parseSkillMarkdown(skillMDPath)
	if err != nil {
		return SkillMeta{}, err
	}
	if skillMeta.Name == "" {
		skillMeta.Name = filepath.Base(dir)
	}
	if skillMeta.Description == "" {
		skillMeta.Description = fmt.Sprintf("Skill: %s", skillMeta.Name)
	}

	// List all files in the skill directory
	files, err := listSkillFiles(dir)
	if err != nil {
		return SkillMeta{}, err
	}

	relDir, err := filepath.Rel(s.skillsDir, dir)
	if err != nil {
		return SkillMeta{}, err
	}
	relDirSlash := filepath.ToSlash(relDir)
	category := determineSkillCategory(strings.Split(relDirSlash, "/"), skillMeta.Category)
	author := extractSkillAuthor(skillMeta.Author)
	tags := extractSkillTags(skillMeta.Name, category, skillMeta.Tags)
	compatibleAgents := determineCompatibleAgents(
		skillMeta.Name,
		skillMeta.Description,
		content,
		category,
		skillMeta.CompatibleAgents,
	)
	sourceURL := buildSourceURL(relDirSlash)

	return SkillMeta{
		ID:               skillID,
		Name:             skillMeta.Name,
		Description:      skillMeta.Description,
		Category:         category,
		Version:          "1.0.0",
		Author:           author,
		Tags:             tags,
		SourceURL:        sourceURL,
		Files:            files,
		Content:          content,
		CompatibleAgents: compatibleAgents,
		DownloadCount:    0,
	}, nil
}

func discoverSkillDirs(root string) ([]string, error) {
	var skillDirs []string
	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			if info.Name() == ".git" {
				return filepath.SkipDir
			}
			return nil
		}
		if info.Name() == "SKILL.md" {
			skillDirs = append(skillDirs, filepath.Dir(path))
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Strings(skillDirs)
	return skillDirs, nil
}

func (s *Server) buildSkillID(skillMDPath string) (string, error) {
	relPath, err := filepath.Rel(s.skillsDir, skillMDPath)
	if err != nil {
		return "", fmt.Errorf("failed to build skill id for %s: %w", skillMDPath, err)
	}

	sum := md5.Sum([]byte(relPath))
	return hex.EncodeToString(sum[:])[:12], nil
}

func buildSkillsDataFile(skills []SkillMeta, categories map[string]string) SkillsDataFile {
	items := make([]SkillListItem, 0, len(skills))
	for _, skill := range skills {
		items = append(items, SkillListItem{
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

	categoryList := make([]string, 0, len(categories))
	for category := range categories {
		categoryList = append(categoryList, category)
	}
	sort.Strings(categoryList)

	sort.Slice(items, func(i, j int) bool {
		return strings.ToLower(items[i].Name) < strings.ToLower(items[j].Name)
	})

	return SkillsDataFile{
		GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		TotalSkills: len(items),
		Categories:  categoryList,
		Skills:      items,
	}
}

func (s *Server) writeSkillsDataFile(data SkillsDataFile) error {
	encoded, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}

	if dir := filepath.Dir(s.skillsDataPath); dir != "." {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return err
		}
	}

	return os.WriteFile(s.skillsDataPath, encoded, 0644)
}

func (s *Server) readSkillsDataFile() (SkillsDataFile, error) {
	var data SkillsDataFile

	encoded, err := os.ReadFile(s.skillsDataPath)
	if err != nil {
		return data, err
	}

	if err := json.Unmarshal(encoded, &data); err != nil {
		return data, err
	}

	return data, nil
}

func determineSkillCategory(pathParts []string, frontmatterCategory string) string {
	if frontmatterCategory != "" {
		return frontmatterCategory
	}

	categoryMap := map[string]string{
		"document-skills":             "Document Processing",
		"composio-skills":             "App Automation",
		"artifacts-builder":           "Development",
		"brand-guidelines":            "Design",
		"canvas-design":               "Creative",
		"changelog-generator":         "Development",
		"competitive-ads-extractor":   "Marketing",
		"connect":                     "Integration",
		"connect-apps":                "Integration",
		"connect-apps-plugin":         "Integration",
		"content-research-writer":     "Writing",
		"developer-growth-analysis":   "Development",
		"domain-name-brainstormer":    "Business",
		"file-organizer":              "Productivity",
		"image-enhancer":              "Creative",
		"internal-comms":              "Communication",
		"invoice-organizer":           "Business",
		"langsmith-fetch":             "Development",
		"lead-research-assistant":     "Sales",
		"mcp-builder":                 "Development",
		"meeting-insights-analyzer":   "Productivity",
		"raffle-winner-picker":        "Utility",
		"skill-creator":               "Development",
		"skill-share":                 "Collaboration",
		"slack-gif-creator":           "Creative",
		"tailored-resume-generator":   "Productivity",
		"template-skill":              "Development",
		"theme-factory":               "Design",
		"twitter-algorithm-optimizer": "Marketing",
		"video-downloader":            "Utility",
		"webapp-testing":              "Development",
	}

	for _, part := range pathParts {
		if category, ok := categoryMap[part]; ok {
			return category
		}
	}

	if len(pathParts) > 0 && pathParts[0] == "composio-skills" {
		return "App Automation"
	}

	return "General"
}

func extractSkillAuthor(frontmatterAuthor string) string {
	if frontmatterAuthor != "" {
		return frontmatterAuthor
	}
	return "ComposioHQ"
}

func extractSkillTags(
	name string,
	category string,
	frontmatterTags []string,
) []string {
	if len(frontmatterTags) > 0 {
		return dedupeStrings(frontmatterTags)
	}

	categoryTags := map[string][]string{
		"Document Processing": {"document", "pdf", "processing"},
		"App Automation":      {"integration", "api", "automation"},
		"Development":         {"development", "code", "programming"},
		"Design":              {"creative", "visual", "design"},
		"Creative":            {"creative", "media", "content"},
		"Marketing":           {"marketing", "social", "growth"},
		"Writing":             {"writing", "content", "documentation"},
		"Business":            {"business", "productivity", "workflow"},
		"Productivity":        {"productivity", "automation", "efficiency"},
		"Communication":       {"communication", "messaging", "collaboration"},
		"Integration":         {"integration", "api", "connection"},
		"Sales":               {"sales", "leads", "crm"},
		"Utility":             {"utility", "tools", "helper"},
		"Collaboration":       {"collaboration", "team", "sharing"},
		"General":             {"general", "utility"},
	}

	tags := append([]string{}, categoryTags[category]...)
	nameLower := strings.ToLower(name)

	if strings.Contains(nameLower, "test") {
		tags = append(tags, "testing")
	}
	if strings.Contains(nameLower, "pdf") {
		tags = append(tags, "pdf")
	}
	if strings.Contains(nameLower, "email") || strings.Contains(nameLower, "mail") {
		tags = append(tags, "email")
	}
	if strings.Contains(nameLower, "git") {
		tags = append(tags, "git")
	}
	if strings.Contains(nameLower, "api") {
		tags = append(tags, "api")
	}
	if strings.Contains(nameLower, "mcp") {
		tags = append(tags, "mcp")
	}

	return dedupeStrings(tags)
}

func determineCompatibleAgents(
	name string,
	description string,
	content string,
	category string,
	frontmatterCompatible []string,
) []string {
	if len(frontmatterCompatible) > 0 {
		return dedupeStrings(frontmatterCompatible)
	}

	text := strings.ToLower(name + " " + description + " " + content)
	switch category {
	case "Document Processing":
		return []string{"claude-code", "cursor", "qwen-code", "codex", "gemini", "copilot"}
	case "Development", "App Automation", "Integration":
		return []string{"codex", "opencode", "cursor", "claude-code", "qwen-code"}
	}

	compatible := []string{"claude-code"}
	if strings.Contains(text, "cursor") || strings.Contains(text, ".cursor") {
		compatible = append(compatible, "cursor")
	}
	if strings.Contains(text, "qwen") || strings.Contains(text, ".qwen") {
		compatible = append(compatible, "qwen-code")
	}
	if strings.Contains(text, "gemini") || strings.Contains(text, "copilot") {
		compatible = append(compatible, "gemini", "copilot")
	}
	if strings.Contains(text, "agentic") || strings.Contains(text, "agent") {
		compatible = append(compatible, "codex", "opencode")
	}
	if strings.Contains(text, "development") ||
		strings.Contains(text, "code") ||
		strings.Contains(text, "git") ||
		strings.Contains(text, "test") {
		compatible = append(compatible, "cursor", "qwen-code", "codex", "opencode")
	}

	return dedupeStrings(compatible)
}

func buildSourceURL(relDir string) string {
	if relDir == "" || relDir == "." {
		return ""
	}

	return fmt.Sprintf(
		"https://github.com/ComposioHQ/awesome-claude-skills/tree/master/%s",
		relDir,
	)
}

func dedupeStrings(values []string) []string {
	seen := make(map[string]bool, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}

func describeCategory(category string) string {
	descriptions := map[string]string{
		"App Automation":      "Automation skills for third-party apps and services",
		"Business":            "Business workflows and operational skills",
		"Collaboration":       "Collaboration and team workflow skills",
		"Communication":       "Messaging and communication skills",
		"Creative":            "Creative media and content skills",
		"Design":              "Design and visual styling skills",
		"Development":         "Development and coding skills",
		"Document Processing": "Document creation and processing skills",
		"General":             "General purpose skills",
		"Integration":         "Integration and connectivity skills",
		"Marketing":           "Marketing and growth skills",
		"Productivity":        "Productivity and organization skills",
		"Sales":               "Sales and lead generation skills",
		"Utility":             "Utility and helper skills",
		"Writing":             "Writing and research skills",
	}

	if description, ok := descriptions[category]; ok {
		return description
	}
	return ""
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
	_ = c.Query("source")

	var result []SkillListItem
	for _, skill := range s.skillsData.Skills {
		if search != "" {
			searchLower := strings.ToLower(search)
			if !strings.Contains(strings.ToLower(skill.Name), searchLower) &&
				!strings.Contains(strings.ToLower(skill.Description), searchLower) {
				continue
			}
		}

		if category != "" && skill.Category != category {
			continue
		}

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
		// Default: sort by name
		for i := 0; i < len(result)-1; i++ {
			for j := i + 1; j < len(result); j++ {
				if strings.ToLower(result[i].Name) > strings.ToLower(result[j].Name) {
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
	for _, category := range s.skillsData.Categories {
		categories = append(categories, SkillCategory{
			ID:          category,
			Name:        category,
			Description: describeCategory(category),
		})
	}

	c.JSON(http.StatusOK, categories)
}

func (s *Server) downloadSkill(c *gin.Context) {
	id := c.Param("id")

	skillDir, ok := s.getSkillDir(id)
	if !ok {
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

	skillDir, ok := s.getSkillDir(id)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "Skill not found"})
		return
	}

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

func (s *Server) getSkillDir(skillID string) (string, bool) {
	skillDir, ok := s.skillPaths[skillID]
	return skillDir, ok
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

// getSyncStatus returns the current sync status
func (s *Server) getSyncStatus(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"mode":             "filesystem",
		"skills_dir":       s.skillsDir,
		"skills_data_path": s.skillsDataPath,
		"generated_at":     s.skillsData.GeneratedAt,
		"local_skills":     len(s.skills),
	})
}

// startPeriodicReload reloads skill metadata from the local filesystem periodically.
func (s *Server) startPeriodicReload(interval time.Duration) {
	fmt.Printf("Starting periodic local skill reload every %v\n", interval)

	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for range ticker.C {
			fmt.Println("Reloading local skills from disk...")
			if err := s.loadSkills(); err != nil {
				fmt.Printf("Warning: local skill reload failed: %v\n", err)
			}
		}
	}()
}

// syncLocalSkills reloads skill metadata from data/skills.
func (s *Server) syncLocalSkills(c *gin.Context) {
	fmt.Println("Reloading local skills from disk...")

	if err := s.loadSkills(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Failed to reload local skills",
			"details": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":           "success",
		"mode":             "filesystem",
		"skills_dir":       s.skillsDir,
		"skills_data_path": s.skillsDataPath,
		"generated_at":     s.skillsData.GeneratedAt,
		"total_skills":     len(s.skills),
	})
}

// syncAll starts a background reload of local skills.
func (s *Server) syncAll(c *gin.Context) {
	fmt.Println("Starting local skill reload...")

	go func() {
		if err := s.loadSkills(); err != nil {
			fmt.Printf("Warning: background local skill reload failed: %v\n", err)
		}
	}()

	c.JSON(http.StatusOK, gin.H{
		"status":  "started",
		"message": "Local skill reload started in background",
	})
}
