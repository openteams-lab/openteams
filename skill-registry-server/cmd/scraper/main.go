package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
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
func parseInstallCount(s string) int64 {
	s = strings.TrimSpace(strings.ToUpper(s))
	if s == "" {
		return 0
	}

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

	linkPattern := regexp.MustCompile(`href="(/([\w-]+)/([\w-]+)/([\w-]+))"`)
	installPattern := regexp.MustCompile(`([\d,.]+[KMB]?)\s*(?:</|$)`)

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

		if seenPaths[fullPath] {
			continue
		}
		seenPaths[fullPath] = true

		// Skip non-skill paths
		if owner == "audits" || owner == "docs" || owner == "api" || owner == "hot" || owner == "trending" {
			continue
		}

		linkIndex := strings.Index(html, match[0])
		searchStart := linkIndex
		if searchStart < 0 {
			searchStart = 0
		}
		searchEnd := searchStart + 500
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

// scrapeSkillsSh fetches and parses skills.sh data
func scrapeSkillsSh() (*SkillsShData, error) {
	data := &SkillsShData{
		GeneratedAt: time.Now(),
		Skills:      make([]SkillsShSkill, 0),
	}

	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	resp, err := client.Get("https://skills.sh")
	if err != nil {
		return nil, fmt.Errorf("failed to fetch skills.sh: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	html := string(body)

	skills := parseSkillsFromHTML(html)
	data.Skills = skills
	data.TotalSkills = len(skills)

	var totalInstalls int64
	for _, skill := range skills {
		totalInstalls += skill.DownloadCount
	}
	data.TotalInstalls = totalInstalls

	return data, nil
}

func main() {
	outputPath := flag.String("output", "skills_sh_data.json", "Output JSON file path")
	verbose := flag.Bool("verbose", false, "Enable verbose output")
	flag.Parse()

	if *verbose {
		fmt.Printf("Starting skills.sh scraper at %s\n", time.Now().Format(time.RFC3339))
	}

	data, err := scrapeSkillsSh()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	if *verbose {
		fmt.Printf("Scraped %d skills\n", data.TotalSkills)
		fmt.Printf("Total installs: %d\n", data.TotalInstalls)
	}

	// Write to file
	jsonData, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error marshaling JSON: %v\n", err)
		os.Exit(1)
	}

	if err := os.WriteFile(*outputPath, jsonData, 0644); err != nil {
		fmt.Fprintf(os.Stderr, "Error writing file: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Data written to %s\n", *outputPath)

	// Print top 10 skills
	if *verbose {
		fmt.Println("\nTop 10 skills by installs:")
		for i, skill := range data.Skills {
			if i >= 10 {
				break
			}
			fmt.Printf("%d. %s - %d installs\n", i+1, skill.Name, skill.DownloadCount)
		}
	}

	if *verbose {
		fmt.Printf("Completed at %s\n", time.Now().Format(time.RFC3339))
	}
}
