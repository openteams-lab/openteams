#!/usr/bin/env python3
"""
Script to import skills from awesome-claude-skills repository into the Skill Registry.
Parses all SKILL.md files and generates a JSON file for the registry.
"""

import os
import re
import json
import hashlib
from pathlib import Path
from datetime import datetime

def parse_skill_md(file_path: Path) -> dict | None:
    """Parse a SKILL.md file and extract skill metadata and content."""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Extract YAML frontmatter
        frontmatter = {}
        if content.startswith('---'):
            parts = content.split('---', 2)
            if len(parts) >= 3:
                fm_text = parts[1].strip()
                for line in fm_text.split('\n'):
                    if ':' in line:
                        key, value = line.split(':', 1)
                        frontmatter[key.strip()] = value.strip()
                skill_content = parts[2].strip()
            else:
                skill_content = content
        else:
            skill_content = content
        
        name = frontmatter.get('name', file_path.parent.name)
        description = frontmatter.get('description', '')
        
        if not name:
            name = file_path.parent.name
        
        # Generate a stable ID based on the path
        relative_path = file_path.relative_to(SKILLS_DIR)
        skill_id = hashlib.md5(str(relative_path).encode()).hexdigest()[:12]
        
        # Determine category based on parent directories
        parts = list(file_path.relative_to(SKILLS_DIR).parts)
        category = determine_category(parts)
        
        # Determine compatible agents
        compatible_agents = determine_compatible_agents(name, description, skill_content)
        
        return {
            'id': skill_id,
            'name': name,
            'description': description or f"Skill: {name}",
            'category': category,
            'version': '1.0.0',
            'author': extract_author(frontmatter),
            'tags': extract_tags(name, description, category),
            'compatible_agents': compatible_agents,
            'source_url': f"https://github.com/ComposioHQ/awesome-claude-skills/tree/master/{'/'.join(parts[:-1])}",
            'content': content,
        }
    except Exception as e:
        print(f"Error parsing {file_path}: {e}")
        return None


def determine_category(path_parts: list) -> str:
    """Determine the category based on path."""
    # Map directory names to categories
    category_map = {
        'document-skills': 'Document Processing',
        'composio-skills': 'App Automation',
        'artifacts-builder': 'Development',
        'brand-guidelines': 'Design',
        'canvas-design': 'Creative',
        'changelog-generator': 'Development',
        'competitive-ads-extractor': 'Marketing',
        'connect': 'Integration',
        'connect-apps': 'Integration',
        'connect-apps-plugin': 'Integration',
        'content-research-writer': 'Writing',
        'developer-growth-analysis': 'Development',
        'domain-name-brainstormer': 'Business',
        'file-organizer': 'Productivity',
        'image-enhancer': 'Creative',
        'internal-comms': 'Communication',
        'invoice-organizer': 'Business',
        'langsmith-fetch': 'Development',
        'lead-research-assistant': 'Sales',
        'mcp-builder': 'Development',
        'meeting-insights-analyzer': 'Productivity',
        'raffle-winner-picker': 'Utility',
        'skill-creator': 'Development',
        'skill-share': 'Collaboration',
        'slack-gif-creator': 'Creative',
        'tailored-resume-generator': 'Productivity',
        'template-skill': 'Development',
        'theme-factory': 'Design',
        'twitter-algorithm-optimizer': 'Marketing',
        'video-downloader': 'Utility',
        'webapp-testing': 'Development',
    }
    
    for part in path_parts:
        if part in category_map:
            return category_map[part]
    
    # Default based on first meaningful directory
    if len(path_parts) > 1:
        parent = path_parts[0]
        if parent == 'composio-skills':
            return 'App Automation'
    
    return 'General'


def determine_compatible_agents(name: str, description: str, content: str) -> list:
    """Determine which agents this skill is compatible with."""
    # All skills are primarily for Claude Code
    compatible = ['claude-code']
    
    text = f"{name} {description} {content}".lower()
    
    # Check for mentions of other agents
    if 'cursor' in text or '.cursor' in text:
        compatible.append('cursor')
    if 'qwen' in text or '.qwen' in text:
        compatible.append('qwen-code')
    if 'gemini' in text or 'copilot' in text:
        compatible.append('gemini')
        compatible.append('copilot')
    if 'agentic' in text or 'agent' in text:
        compatible.extend(['codex', 'opencode'])
    
    # Document skills work with all agents
    if 'document' in text or 'pdf' in text or 'xlsx' in text or 'docx' in text:
        compatible = ['claude-code', 'cursor', 'qwen-code', 'codex', 'gemini', 'copilot']
    
    # Development skills work with coding agents
    if 'development' in text or 'code' in text or 'git' in text or 'test' in text:
        compatible = ['claude-code', 'cursor', 'qwen-code', 'codex', 'opencode']
    
    return list(set(compatible))


def extract_author(frontmatter: dict) -> str:
    """Extract author information."""
    if 'author' in frontmatter:
        return frontmatter['author']
    return 'ComposioHQ'


def extract_tags(name: str, description: str, category: str) -> list:
    """Extract relevant tags."""
    tags = []
    
    # Add category as tag
    category_tags = {
        'Document Processing': ['document', 'pdf', 'processing'],
        'App Automation': ['automation', 'integration', 'api'],
        'Development': ['development', 'code', 'programming'],
        'Design': ['design', 'creative', 'visual'],
        'Creative': ['creative', 'media', 'content'],
        'Marketing': ['marketing', 'social', 'growth'],
        'Writing': ['writing', 'content', 'documentation'],
        'Business': ['business', 'productivity', 'workflow'],
        'Productivity': ['productivity', 'automation', 'efficiency'],
        'Communication': ['communication', 'messaging', 'collaboration'],
        'Integration': ['integration', 'api', 'connection'],
        'Sales': ['sales', 'leads', 'crm'],
        'Utility': ['utility', 'tools', 'helper'],
        'Collaboration': ['collaboration', 'team', 'sharing'],
        'General': ['general', 'utility'],
    }
    
    tags.extend(category_tags.get(category, ['general']))
    
    # Add specific tags based on name
    name_lower = name.lower()
    if 'test' in name_lower:
        tags.append('testing')
    if 'pdf' in name_lower:
        tags.append('pdf')
    if 'email' in name_lower or 'mail' in name_lower:
        tags.append('email')
    if 'git' in name_lower:
        tags.append('git')
    if 'api' in name_lower:
        tags.append('api')
    if 'mcp' in name_lower:
        tags.append('mcp')
    
    return list(set(tags))


def main():
    """Main function to process all skills."""
    skills = []
    categories = set()
    
    # Find all SKILL.md files
    skill_files = list(SKILLS_DIR.rglob('SKILL.md'))
    print(f"Found {len(skill_files)} skill files")
    
    for i, skill_file in enumerate(skill_files):
        skill = parse_skill_md(skill_file)
        if skill:
            skills.append(skill)
            if skill['category']:
                categories.add(skill['category'])
        
        if (i + 1) % 100 == 0:
            print(f"Processed {i + 1}/{len(skill_files)} files")
    
    print(f"\nTotal skills parsed: {len(skills)}")
    print(f"Categories: {sorted(categories)}")
    
    # Write skills to JSON file
    output = {
        'generated_at': datetime.utcnow().isoformat(),
        'total_skills': len(skills),
        'categories': sorted(list(categories)),
        'skills': skills,
    }
    
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    
    print(f"\nOutput written to {OUTPUT_FILE}")
    
    # Also write a summary file for quick reference
    summary = []
    for skill in skills:
        summary.append({
            'id': skill['id'],
            'name': skill['name'],
            'description': skill['description'][:100] + '...' if len(skill['description']) > 100 else skill['description'],
            'category': skill['category'],
        })
    
    summary_file = OUTPUT_FILE.replace('.json', '_summary.json')
    with open(summary_file, 'w', encoding='utf-8') as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)
    
    print(f"Summary written to {summary_file}")


if __name__ == '__main__':
    # Configuration
    SKILLS_DIR = Path(r'E:\workspace\projectSS\openteams\awesome-claude-skills-temp')
    OUTPUT_FILE = r'E:\workspace\projectSS\openteams\crates\db\seed\skills_registry.json'
    
    # Ensure output directory exists
    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    
    main()