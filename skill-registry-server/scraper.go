package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

// SkillsShSkill represents a skill from skills.sh
type SkillsShSkill struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Owner         string `json:"owner"`
	Repo          string `json:"repo"`
	SourceURL     string `json:"source_url"`
	DownloadCount int64  `json:"download_count"`
}

// SkillsShData represents the scraped data from skills.sh
type SkillsShData struct {
	GeneratedAt   time.Time       `json:"generated_at"`
	TotalSkills   int             `json:"total_skills"`
	TotalInstalls int64           `json:"total_installs"`
	Skills        []SkillsShSkill `json:"skills"`
}

// parseInstallCount converts install count string to int64
// Examples: "421.1K" -> 421100, "1.5M" -> 1500000
func parseInstallCount(s string) int64 {
	s = strings.TrimSpace(strings.ToUpper(s))
	if s == "" {
		return 0
	}

	// Remove commas
	s = strings.ReplaceAll(s, ",", "")

	var multiplier int64 = 1
	if strings.HasSuffix(s, "K") {
		multiplier = 1000
		s = strings.TrimSuffix(s, "K")
	} else if strings.HasSuffix(s, "M") {
		multiplier = 1000000
		s = strings.TrimSuffix(s, "M")
	} else if strings.HasSuffix(s, "B") {
		multiplier = 1000000000
		s = strings.TrimSuffix(s, "B")
	}

	value, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0
	}

	return int64(value * float64(multiplier))
}

// parseSkillsFromHTML extracts skills from HTML content
func parseSkillsFromHTML(html string) []SkillsShSkill {
	skills := make([]SkillsShSkill, 0)

	// Regex patterns
	// Match links like: href="/owner/repo/skill-name"
	linkPattern := regexp.MustCompile(`href="(/([\w-]+)/([\w-]+)/([\w-]+))"`)
	// Match install counts like: 421.1K, 1.5M, etc.
	installPattern := regexp.MustCompile(`([\d,.]+[KMB]?)\s*(?:</|$)`)

	// Find all skill links
	matches := linkPattern.FindAllStringSubmatch(html, -1)
	seenPaths := make(map[string]bool)

	for _, match := range matches {
		if len(match) < 5 {
			continue
		}

		fullPath := match[1]
		owner := match[2]
		repo := match[3]
		skillName := match[4]

		// Skip if already seen
		if seenPaths[fullPath] {
			continue
		}
		seenPaths[fullPath] = true

		// Skip non-skill paths (like /docs, /audits, etc.)
		if owner == "audits" || owner == "docs" || owner == "api" || owner == "hot" || owner == "trending" {
			continue
		}

		// Find install count near the link
		// Look for install count in a reasonable window around the link
		linkIndex := strings.Index(html, match[0])
		searchStart := linkIndex
		if searchStart < 0 {
			searchStart = 0
		}
		searchEnd := searchStart + 500 // Look within 500 chars after the link
		if searchEnd > len(html) {
			searchEnd = len(html)
		}

		searchArea := html[searchStart:searchEnd]
		installMatch := installPattern.FindStringSubmatch(searchArea)

		var installCount int64 = 0
		if len(installMatch) > 1 {
			installCount = parseInstallCount(installMatch[1])
		}

		skill := SkillsShSkill{
			ID:            fmt.Sprintf("%s/%s/%s", owner, repo, skillName),
			Name:          skillName,
			Owner:         owner,
			Repo:          repo,
			SourceURL:     fmt.Sprintf("https://github.com/%s/%s", owner, repo),
			DownloadCount: installCount,
		}

		skills = append(skills, skill)
	}

	return skills
}

// ScrapeSkillsSh uses simple HTTP requests to scrape skills.sh
func ScrapeSkillsSh() (*SkillsShData, error) {
	return ScrapeSkillsShWithOptions(false)
}

// ScrapeSkillsShWithOptions scrapes skills.sh with optional pagination
// If fullScrape is true, it will fetch multiple pages to get more skills
func ScrapeSkillsShWithOptions(fullScrape bool) (*SkillsShData, error) {
	data := &SkillsShData{
		GeneratedAt: time.Now(),
		Skills:      make([]SkillsShSkill, 0),
	}

	client := &http.Client{
		Timeout: 60 * time.Second,
	}

	// Endpoints to scrape for comprehensive coverage
	endpoints := []string{
		"https://skills.sh",
	}

	if fullScrape {
		// Add more endpoints for full coverage
		endpoints = append(endpoints,
			"https://skills.sh/hot",
			"https://skills.sh?sort=installs",
			"https://skills.sh?sort=recent",
		)
	}

	seenSkills := make(map[string]bool)

	for _, endpoint := range endpoints {
		fmt.Printf("Fetching %s...\n", endpoint)

		resp, err := client.Get(endpoint)
		if err != nil {
			fmt.Printf("Warning: failed to fetch %s: %v\n", endpoint, err)
			continue
		}

		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			fmt.Printf("Warning: failed to read response from %s: %v\n", endpoint, err)
			continue
		}

		html := string(body)
		skills := parseSkillsFromHTML(html)

		for _, skill := range skills {
			if !seenSkills[skill.ID] {
				seenSkills[skill.ID] = true
				data.Skills = append(data.Skills, skill)
			}
		}

		// Small delay between requests to be polite
		if fullScrape {
			time.Sleep(500 * time.Millisecond)
		}
	}

	data.TotalSkills = len(data.Skills)

	// Calculate total installs
	var totalInstalls int64
	for _, skill := range data.Skills {
		totalInstalls += skill.DownloadCount
	}
	data.TotalInstalls = totalInstalls

	// Sort by download count descending
	sortSkillsByDownloads(data.Skills)

	return data, nil
}

// sortSkillsByDownloads sorts skills by download count in descending order
func sortSkillsByDownloads(skills []SkillsShSkill) {
	for i := 0; i < len(skills)-1; i++ {
		for j := i + 1; j < len(skills); j++ {
			if skills[j].DownloadCount > skills[i].DownloadCount {
				skills[i], skills[j] = skills[j], skills[i]
			}
		}
	}
}

// FetchSkillDetails fetches detailed skill information from a skill's GitHub page
func FetchSkillDetails(owner, repo, skillName string) (*SkillMeta, error) {
	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	// Fetch SKILL.md from GitHub raw content
	rawURL := fmt.Sprintf("https://raw.githubusercontent.com/%s/%s/main/skills/%s/SKILL.md", owner, repo, skillName)
	if skillName == "" || skillName == repo {
		// Try root SKILL.md
		rawURL = fmt.Sprintf("https://raw.githubusercontent.com/%s/%s/main/SKILL.md", owner, repo)
	}

	resp, err := client.Get(rawURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("skill not found: %s", rawURL)
	}

	content, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	// Parse frontmatter
	fm, bodyContent, err := parseSkillMarkdownFromContent(string(content))
	if err != nil {
		return nil, err
	}

	return &SkillMeta{
		ID:          fmt.Sprintf("%s/%s/%s", owner, repo, skillName),
		Name:        fm.Name,
		Description: fm.Description,
		Version:     "1.0.0",
		Author:      owner,
		SourceURL:   fmt.Sprintf("https://github.com/%s/%s", owner, repo),
		Content:     bodyContent,
	}, nil
}

func parseSkillMarkdownFromContent(content string) (SkillFrontmatter, string, error) {
	if !strings.HasPrefix(content, "---") {
		name := "unknown"
		return SkillFrontmatter{
			Name:        name,
			Description: "No description available",
		}, content, nil
	}

	parts := strings.SplitN(content, "---", 3)
	if len(parts) < 3 {
		return SkillFrontmatter{
			Name:        "unknown",
			Description: "No description available",
		}, content, nil
	}

	var fm SkillFrontmatter
	if err := yaml.Unmarshal([]byte(parts[1]), &fm); err != nil {
		return SkillFrontmatter{}, "", err
	}

	return fm, content, nil
}

// WriteSkillsData writes skills data to a JSON file
func WriteSkillsData(data *SkillsShData, outputPath string) error {
	jsonData, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal skills data: %w", err)
	}

	return os.WriteFile(outputPath, jsonData, 0644)
}

// ReadSkillsData reads skills data from a JSON file
func ReadSkillsData(inputPath string) (*SkillsShData, error) {
	data, err := os.ReadFile(inputPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read skills data: %w", err)
	}

	var skillsData SkillsShData
	if err := json.Unmarshal(data, &skillsData); err != nil {
		return nil, fmt.Errorf("failed to unmarshal skills data: %w", err)
	}

	return &skillsData, nil
}

// RunScraper runs the scraper and outputs to file
func RunScraper(outputPath string) error {
	return RunScraperWithOptions(outputPath, false)
}

// RunScraperWithOptions runs the scraper with optional full scrape
func RunScraperWithOptions(outputPath string, fullScrape bool) error {
	fmt.Println("Starting skills.sh scraper...")
	if fullScrape {
		fmt.Println("Full scrape mode enabled - fetching multiple pages")
	}

	data, err := ScrapeSkillsShWithOptions(fullScrape)
	if err != nil {
		return fmt.Errorf("failed to scrape skills.sh: %w", err)
	}

	fmt.Printf("Scraped %d skills\n", data.TotalSkills)
	fmt.Printf("Total installs: %d\n", data.TotalInstalls)

	if outputPath != "" {
		if err := WriteSkillsData(data, outputPath); err != nil {
			return fmt.Errorf("failed to write data: %w", err)
		}
		fmt.Printf("Data written to %s\n", outputPath)
	}

	// Print top 10 skills
	fmt.Println("\nTop 10 skills by installs:")
	for i, skill := range data.Skills {
		if i >= 10 {
			break
		}
		fmt.Printf("%d. %s - %d installs\n", i+1, skill.Name, skill.DownloadCount)
	}

	return nil
}
