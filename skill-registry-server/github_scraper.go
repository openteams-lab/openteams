package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// GitHubSearchResult represents the GitHub Search API response
type GitHubSearchResult struct {
	TotalCount int                  `json:"total_count"`
	Items      []GitHubSearchItem   `json:"items"`
}

// GitHubSearchItem represents an item from GitHub Search API
type GitHubSearchItem struct {
	Name       string        `json:"name"`
	Path       string        `json:"path"`
	Repository GitHubRepo    `json:"repository"`
	HTMLURL    string        `json:"html_url"`
}

// GitHubRepo represents repository info from GitHub Search API
type GitHubRepo struct {
	FullName    string `json:"full_name"`
	Owner       GitHubOwner `json:"owner"`
	Name        string `json:"name"`
	Description string `json:"description"`
	HTMLURL     string `json:"html_url"`
	Topics      []string `json:"topics"`
}

// GitHubOwner represents repository owner from GitHub Search API
type GitHubOwner struct {
	Login string `json:"login"`
}

// GitHubSkillData represents scraped skill data from GitHub
type GitHubSkillData struct {
	GeneratedAt  time.Time          `json:"generated_at"`
	TotalSkills  int                `json:"total_skills"`
	Skills       []GitHubSkillItem  `json:"skills"`
}

// GitHubSkillItem represents a skill found on GitHub
type GitHubSkillItem struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	Description   string   `json:"description"`
	Owner         string   `json:"owner"`
	Repo          string   `json:"repo"`
	SourceURL     string   `json:"source_url"`
	SkillPath     string   `json:"skill_path"`
	Topics        []string `json:"topics,omitempty"`
	DownloadCount int64    `json:"download_count"` // From skills.sh if available
}

// GitHubScraper handles GitHub API interactions
type GitHubScraper struct {
	client      *http.Client
	token       string
	limiter     *rate.Limiter
	mu          sync.Mutex
}

// NewGitHubScraper creates a new GitHub scraper
func NewGitHubScraper() *GitHubScraper {
	token := os.Getenv("GITHUB_TOKEN")

	// Rate limiter: 30 requests per minute for search API (with token)
	// Without token: 10 requests per minute
	var rateLimit rate.Limit
	if token != "" {
		rateLimit = rate.Every(2 * time.Second) // ~30 req/min
	} else {
		rateLimit = rate.Every(6 * time.Second) // ~10 req/min
	}

	return &GitHubScraper{
		client: &http.Client{
			Timeout: 60 * time.Second,
		},
		token:   token,
		limiter: rate.NewLimiter(rateLimit, 1),
	}
}

// doRequest performs an HTTP request with rate limiting
func (g *GitHubScraper) doRequest(ctx context.Context, url string) (*http.Response, error) {
	// Wait for rate limiter
	if err := g.limiter.Wait(ctx); err != nil {
		return nil, fmt.Errorf("rate limiter error: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Accept", "application/vnd.github.v3+json")
	req.Header.Set("User-Agent", "skill-registry-server")

	if g.token != "" {
		req.Header.Set("Authorization", "Bearer "+g.token)
	}

	return g.client.Do(req)
}

// SearchSkills searches GitHub for skill repositories
func (g *GitHubScraper) SearchSkills(ctx context.Context) (*GitHubSkillData, error) {
	data := &GitHubSkillData{
		GeneratedAt: time.Now(),
		Skills:      make([]GitHubSkillItem, 0),
	}

	seenSkills := make(map[string]bool)

	// Search queries to find skills
	queries := []string{
		"filename:SKILL.md",                           // Files named SKILL.md
		"topic:claude-skill",                          // Repos with claude-skill topic
		"topic:claude-code",                           // Repos with claude-code topic
		"topic:claude-skills",                         // Repos with claude-skills topic
		"claude skill in:description",                 // Description mentions claude skill
		"claude-code skill in:description",            // Description mentions claude-code skill
		"awesome-claude-skills",                       // Awesome lists
	}

	for _, query := range queries {
		fmt.Printf("Searching GitHub: %s\n", query)

		skills, err := g.searchWithQuery(ctx, query)
		if err != nil {
			fmt.Printf("Warning: search failed for '%s': %v\n", query, err)
			continue
		}

		for _, skill := range skills {
			if !seenSkills[skill.ID] {
				seenSkills[skill.ID] = true
				data.Skills = append(data.Skills, skill)
			}
		}

		fmt.Printf("  Found %d new skills (total: %d)\n", len(skills), len(data.Skills))
	}

	data.TotalSkills = len(data.Skills)

	return data, nil
}

// searchWithQuery performs a single search query
func (g *GitHubScraper) searchWithQuery(ctx context.Context, query string) ([]GitHubSkillItem, error) {
	var allItems []GitHubSkillItem

	// Search code for SKILL.md files
	if strings.Contains(query, "filename:") {
		items, err := g.searchCode(ctx, query)
		if err != nil {
			return nil, err
		}
		allItems = append(allItems, items...)
	} else {
		// Search repositories
		items, err := g.searchRepos(ctx, query)
		if err != nil {
			return nil, err
		}
		allItems = append(allItems, items...)
	}

	return allItems, nil
}

// searchCode searches GitHub code for SKILL.md files
func (g *GitHubScraper) searchCode(ctx context.Context, query string) ([]GitHubSkillItem, error) {
	var allItems []GitHubSkillItem

	// Paginate through results (max 1000 results)
	for page := 1; page <= 10; page++ {
		url := fmt.Sprintf("https://api.github.com/search/code?q=%s&per_page=100&page=%d",
			strings.ReplaceAll(query, " ", "+"), page)

		resp, err := g.doRequest(ctx, url)
		if err != nil {
			return allItems, err
		}

		if resp.StatusCode == 403 {
			// Rate limited - wait and retry
			resp.Body.Close()
			fmt.Println("Rate limited, waiting 60 seconds...")
			time.Sleep(60 * time.Second)
			continue
		}

		if resp.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			return allItems, fmt.Errorf("GitHub API error: %s - %s", resp.Status, string(body))
		}

		var result GitHubSearchResult
		if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
			resp.Body.Close()
			return allItems, err
		}
		resp.Body.Close()

		// Convert items to skills
		for _, item := range result.Items {
			skill := GitHubSkillItem{
				ID:          fmt.Sprintf("%s/%s", item.Repository.FullName, extractSkillName(item.Path)),
				Name:        extractSkillName(item.Path),
				Description: item.Repository.Description,
				Owner:       item.Repository.Owner.Login,
				Repo:        item.Repository.Name,
				SourceURL:   item.Repository.HTMLURL,
				SkillPath:   item.Path,
				Topics:      item.Repository.Topics,
			}
			allItems = append(allItems, skill)
		}

		// Check if we've fetched all results
		if len(result.Items) < 100 || len(allItems) >= result.TotalCount {
			break
		}
	}

	return allItems, nil
}

// searchRepos searches GitHub repositories
func (g *GitHubScraper) searchRepos(ctx context.Context, query string) ([]GitHubSkillItem, error) {
	var allItems []GitHubSkillItem

	// Paginate through results
	for page := 1; page <= 10; page++ {
		url := fmt.Sprintf("https://api.github.com/search/repositories?q=%s&per_page=100&page=%d",
			strings.ReplaceAll(query, " ", "+"), page)

		resp, err := g.doRequest(ctx, url)
		if err != nil {
			return allItems, err
		}

		if resp.StatusCode == 403 {
			resp.Body.Close()
			fmt.Println("Rate limited, waiting 60 seconds...")
			time.Sleep(60 * time.Second)
			continue
		}

		if resp.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			return allItems, fmt.Errorf("GitHub API error: %s - %s", resp.Status, string(body))
		}

		var result struct {
			TotalCount int `json:"total_count"`
			Items      []GitHubRepo `json:"items"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
			resp.Body.Close()
			return allItems, err
		}
		resp.Body.Close()

		// Convert repos to skills
		for _, repo := range result.Items {
			skill := GitHubSkillItem{
				ID:          repo.FullName,
				Name:        repo.Name,
				Description: repo.Description,
				Owner:       repo.Owner.Login,
				Repo:        repo.Name,
				SourceURL:   repo.HTMLURL,
				Topics:      repo.Topics,
			}
			allItems = append(allItems, skill)
		}

		// Check if we've fetched all results
		if len(result.Items) < 100 || len(allItems) >= result.TotalCount {
			break
		}
	}

	return allItems, nil
}

// extractSkillName extracts the skill name from a file path
func extractSkillName(path string) string {
	// Path could be: skills/my-skill/SKILL.md or just SKILL.md
	parts := strings.Split(path, "/")

	if len(parts) >= 2 {
		// Return the directory name before SKILL.md
		return parts[len(parts)-2]
	}

	// Fallback to removing SKILL.md
	return strings.TrimSuffix(parts[0], "SKILL.md")
}

// MergeWithSkillsSh merges GitHub data with skills.sh download counts
func (g *GitHubScraper) MergeWithSkillsSh(githubData *GitHubSkillData, skillsShData *SkillsShData) {
	if skillsShData == nil || len(skillsShData.Skills) == 0 {
		return
	}

	// Build a map of download counts by various identifiers
	downloadCounts := make(map[string]int64)
	for _, skill := range skillsShData.Skills {
		downloadCounts[skill.ID] = skill.DownloadCount
		downloadCounts[skill.Name] = skill.DownloadCount
		downloadCounts[strings.ToLower(skill.Name)] = skill.DownloadCount
		// Also map by owner/repo
		key := fmt.Sprintf("%s/%s", skill.Owner, skill.Repo)
		downloadCounts[key] = skill.DownloadCount
	}

	// Apply download counts to GitHub skills
	for i := range githubData.Skills {
		skill := &githubData.Skills[i]

		// Try different matching strategies
		if count, ok := downloadCounts[skill.ID]; ok {
			skill.DownloadCount = count
		} else if count, ok := downloadCounts[skill.Name]; ok {
			skill.DownloadCount = count
		} else if count, ok := downloadCounts[strings.ToLower(skill.Name)]; ok {
			skill.DownloadCount = count
		} else {
			key := fmt.Sprintf("%s/%s", skill.Owner, skill.Repo)
			if count, ok := downloadCounts[key]; ok {
				skill.DownloadCount = count
			}
		}
	}
}

// ConvertToSkillsMeta converts GitHub skill data to SkillMeta for API responses
func ConvertGitHubToSkillMeta(skills []GitHubSkillItem) []SkillMeta {
	result := make([]SkillMeta, 0, len(skills))

	for _, skill := range skills {
		meta := SkillMeta{
			ID:               skill.ID,
			Name:             skill.Name,
			Description:      skill.Description,
			Category:         getCategoryFromName(skill.Name),
			Version:          "1.0.0",
			Author:           skill.Owner,
			Tags:             skill.Topics,
			SourceURL:        skill.SourceURL,
			CompatibleAgents: []string{"claude-code"},
			DownloadCount:    skill.DownloadCount,
		}
		result = append(result, meta)
	}

	return result
}

// WriteGitHubSkillsData writes GitHub skills data to a JSON file
func WriteGitHubSkillsData(data *GitHubSkillData, outputPath string) error {
	jsonData, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal skills data: %w", err)
	}

	return os.WriteFile(outputPath, jsonData, 0644)
}

// ReadGitHubSkillsData reads GitHub skills data from a JSON file
func ReadGitHubSkillsData(inputPath string) (*GitHubSkillData, error) {
	data, err := os.ReadFile(inputPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read skills data: %w", err)
	}

	var skillsData GitHubSkillData
	if err := json.Unmarshal(data, &skillsData); err != nil {
		return nil, fmt.Errorf("failed to unmarshal skills data: %w", err)
	}

	return &skillsData, nil
}

// RunGitHubScraper runs the GitHub scraper and outputs to file
func RunGitHubScraper(ctx context.Context, outputPath string, skillsShData *SkillsShData) error {
	fmt.Println("Starting GitHub scraper...")

	scraper := NewGitHubScraper()

	if scraper.token == "" {
		fmt.Println("Warning: GITHUB_TOKEN not set, rate limits will be very low")
	}

	data, err := scraper.SearchSkills(ctx)
	if err != nil {
		return fmt.Errorf("failed to search GitHub: %w", err)
	}

	// Merge with skills.sh data for download counts
	if skillsShData != nil {
		fmt.Println("Merging with skills.sh download counts...")
		scraper.MergeWithSkillsSh(data, skillsShData)
	}

	fmt.Printf("Found %d skills from GitHub\n", data.TotalSkills)

	if outputPath != "" {
		if err := WriteGitHubSkillsData(data, outputPath); err != nil {
			return fmt.Errorf("failed to write data: %w", err)
		}
		fmt.Printf("Data written to %s\n", outputPath)
	}

	// Print top 10 skills by download count
	fmt.Println("\nTop 10 skills by downloads:")
	sortGitHubSkillsByDownloads(data.Skills)
	for i, skill := range data.Skills {
		if i >= 10 {
			break
		}
		fmt.Printf("%d. %s (%s) - %d downloads\n", i+1, skill.Name, skill.Owner, skill.DownloadCount)
	}

	return nil
}

// sortGitHubSkillsByDownloads sorts skills by download count descending
func sortGitHubSkillsByDownloads(skills []GitHubSkillItem) {
	for i := 0; i < len(skills)-1; i++ {
		for j := i + 1; j < len(skills); j++ {
			if skills[j].DownloadCount > skills[i].DownloadCount {
				skills[i], skills[j] = skills[j], skills[i]
			}
		}
	}
}
