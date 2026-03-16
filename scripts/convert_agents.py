#!/usr/bin/env python3
"""
Convert external agent definitions to internal preset format.

This script reads agent definitions from the external directory and converts them
to the internal preset format used by the agents-chatgroup application.
"""

import os
import re
import csv
import yaml
from pathlib import Path
from typing import Dict, Tuple, Optional

# Paths
EXTERNAL_AGENTS_DIR = Path(r"E:\workspace\projectSS\research\docs\agency-agents-temp\integrations\opencode\agents")
INTERNAL_PRESETS_DIR = Path(r"E:\workspace\projectSS\agents-chatgroup\crates\services\src\services\config\presets\roles")
MANIFEST_PATH = Path(r"E:\workspace\projectSS\agents-chatgroup\scripts\manifest.csv")

# Category-based model mapping
CATEGORY_MAPPING = {
    'Development': ('CLAUDE_CODE', 'claude-opus-4-6'),
    'Product & Design': ('GEMINI', 'gemini-3-pro-preview'),
    'Sales & Business': ('CLAUDE_CODE', 'claude-sonnet-4-6'),
    'Content & Marketing': ('CLAUDE_CODE', 'claude-sonnet-4-6'),
    'Game Development': ('CLAUDE_CODE', 'claude-opus-4-6'),
    'Data & Analytics': ('CLAUDE_CODE', 'claude-opus-4-6'),
    'Compliance & Security': ('CLAUDE_CODE', 'claude-opus-4-6'),
    'Operations & Support': ('CLAUDE_CODE', 'claude-sonnet-4-6'),
}

# Keywords for categorization
CATEGORY_KEYWORDS = {
    'Development': [
        'engineer', 'developer', 'architect', 'devops', 'backend', 'frontend',
        'fullstack', 'mobile', 'embedded', 'firmware', 'code', 'api', 'database',
        'infrastructure', 'sre', 'security engineer', 'ai engineer', 'ml engineer',
        'solidity', 'smart contract', 'blockchain security'
    ],
    'Game Development': [
        'unity', 'unreal', 'godot', 'roblox', 'game design', 'level design',
        'narrative design', 'technical artist', 'game', 'spatial', 'visionos',
        'xr', 'cockpit interaction'
    ],
    'Product & Design': [
        'ui designer', 'ux', 'product manager', 'project manager', 'designer',
        'brand', 'visual', 'inclusive visuals', 'storyteller', 'shepherd'
    ],
    'Sales & Business': [
        'sales', 'account', 'deal', 'pipeline', 'outbound', 'discovery coach',
        'proposal', 'revenue', 'growth hacker', 'e-commerce', 'livestream commerce',
        'cross-border'
    ],
    'Content & Marketing': [
        'content', 'seo', 'social media', 'marketing', 'linkedin', 'instagram',
        'twitter', 'tiktok', 'douyin', 'weibo', 'wechat', 'zhihu', 'xiaohongshu',
        'bilibili', 'kuaishou', 'podcast', 'video editing', 'short-video',
        'ppc campaign', 'paid social', 'search query', 'baidu seo', 'app store'
    ],
    'Compliance & Security': [
        'compliance', 'legal', 'auditor', 'healthcare marketing', 'threat detection',
        'accessibility', 'model qa', 'test results analyzer', 'security auditor'
    ],
    'Data & Analytics': [
        'data engineer', 'analytics', 'finance tracker', 'experiment tracker',
        'evidence collector', 'feedback synthesizer', 'consolidation',
        'data remediation'
    ],
    'Operations & Support': [
        'support', 'recruitment', 'study abroad', 'studio operations',
        'producer', 'terminal integration', 'mcp builder', 'feishu', 'jira',
        'workflow steward', 'government digital', 'presales'
    ],
}


def parse_frontmatter(content: str) -> Tuple[Optional[Dict], str]:
    """Parse YAML frontmatter and body from markdown content."""
    pattern = re.compile(r'^---\s*\n(.*?)\n---\s*\n(.*)$', re.DOTALL)
    match = pattern.match(content)

    if not match:
        return None, content

    frontmatter_str, body = match.groups()

    try:
        frontmatter = yaml.safe_load(frontmatter_str)
        return frontmatter, body.strip()
    except yaml.YAMLError as e:
        print(f"Error parsing YAML frontmatter: {e}")
        return None, content


def categorize_agent(name: str, description: str) -> str:
    """Categorize an agent based on keywords in name and description."""
    text = (name + ' ' + description).lower()

    # Check each category's keywords
    for category, keywords in CATEGORY_KEYWORDS.items():
        for keyword in keywords:
            if keyword.lower() in text:
                return category

    # Default category
    return 'Operations & Support'


def generate_id_from_filename(filename: str) -> str:
    """Generate preset ID from filename (already in kebab-case)."""
    return filename.replace('.md', '')


def check_id_conflict(preset_id: str, existing_ids: set) -> str:
    """Check for ID conflicts and resolve with numeric suffix if needed."""
    if preset_id not in existing_ids:
        return preset_id

    counter = 2
    while f"{preset_id}-{counter}" in existing_ids:
        counter += 1

    new_id = f"{preset_id}-{counter}"
    print(f"  [WARN] ID conflict resolved: {preset_id} -> {new_id}")
    return new_id


def convert_agent(
    input_path: Path,
    existing_ids: set
) -> Tuple[str, str, Dict]:
    """Convert an external agent definition to internal preset format."""
    # Read file
    content = input_path.read_text(encoding='utf-8')

    # Parse frontmatter
    frontmatter, body = parse_frontmatter(content)

    if not frontmatter:
        raise ValueError(f"No frontmatter found in {input_path.name}")

    # Extract fields
    name = frontmatter.get('name', '')
    description = frontmatter.get('description', '')
    color = frontmatter.get('color', '#6B7280')

    if not name or not description:
        raise ValueError(f"Missing name or description in {input_path.name}")

    # Generate ID from filename (already kebab-case)
    base_id = generate_id_from_filename(input_path.name)
    preset_id = check_id_conflict(base_id, existing_ids)
    existing_ids.add(preset_id)

    # Categorize agent
    category = categorize_agent(name, description)

    # Get runner type and model
    runner_type, recommended_model = CATEGORY_MAPPING[category]

    # Build new frontmatter
    new_frontmatter = {
        'id': preset_id,
        'name': name,
        'description': description,
        'runner_type': runner_type,
        'recommended_model': recommended_model,
        'tools_enabled': {
            'metadata': {
                'color': color,
                'category': category
            }
        }
    }

    # Construct output markdown
    frontmatter_yaml = yaml.dump(
        new_frontmatter,
        default_flow_style=False,
        allow_unicode=True,
        sort_keys=False
    )

    output_content = f"---\n{frontmatter_yaml}---\n\n{body}"

    # Metadata for manifest
    metadata = {
        'id': preset_id,
        'name': name,
        'description': description,
        'category': category,
        'color': color,
        'runner_type': runner_type,
        'recommended_model': recommended_model,
    }

    return preset_id, output_content, metadata


def main():
    """Main conversion process."""
    print("=" * 80)
    print("Agent Conversion Script")
    print("=" * 80)
    print()

    # Check external directory exists
    if not EXTERNAL_AGENTS_DIR.exists():
        print(f"❌ External agents directory not found: {EXTERNAL_AGENTS_DIR}")
        return

    # Ensure output directory exists
    INTERNAL_PRESETS_DIR.mkdir(parents=True, exist_ok=True)

    # Get all existing preset IDs (from the 22 existing presets)
    existing_presets = {
        'coordinator_pmo', 'product_manager', 'system_architect',
        'prompt_engineer', 'frontend_engineer', 'backend_engineer',
        'fullstack_engineer', 'qa_tester', 'ux_ui_designer',
        'safety_policy_officer', 'solution_manager', 'code_reviewer',
        'devops_engineer', 'product_analyst', 'data_analyst',
        'technical_writer', 'content_researcher', 'content_editor',
        'frontier_researcher', 'marketing_specialist', 'video_editor',
        'market_analyst'
    }

    # Get all agent files
    agent_files = sorted(EXTERNAL_AGENTS_DIR.glob('*.md'))

    print(f"Found {len(agent_files)} agent files to convert")
    print()

    # Track conversions
    manifest_data = []
    converted_count = 0
    error_count = 0
    category_counts = {cat: 0 for cat in CATEGORY_MAPPING.keys()}

    # Convert each agent
    for agent_file in agent_files:
        try:
            preset_id, content, metadata = convert_agent(agent_file, existing_presets)

            # Write converted file
            output_path = INTERNAL_PRESETS_DIR / f"{preset_id}.md"
            output_path.write_text(content, encoding='utf-8')

            # Track in manifest
            manifest_data.append(metadata)

            # Update counters
            converted_count += 1
            category_counts[metadata['category']] += 1

            print(f"[OK] {agent_file.name:45} -> {preset_id:45} ({metadata['category']})")

        except Exception as e:
            error_count += 1
            print(f"[ERR] {agent_file.name:45} -> ERROR: {e}")

    print()
    print("=" * 80)
    print("Conversion Summary")
    print("=" * 80)
    print(f"Total files:     {len(agent_files)}")
    print(f"Converted:       {converted_count}")
    print(f"Errors:          {error_count}")
    print()

    print("Category Distribution:")
    for category, count in sorted(category_counts.items(), key=lambda x: -x[1]):
        print(f"  {category:30} {count:3} agents")
    print()

    # Write manifest CSV
    if manifest_data:
        with open(MANIFEST_PATH, 'w', newline='', encoding='utf-8') as f:
            fieldnames = ['id', 'name', 'description', 'category', 'color', 'runner_type', 'recommended_model']
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(manifest_data)

        print(f"[OK] Manifest written to: {MANIFEST_PATH}")
        print()

    print("=" * 80)
    print("Conversion Complete!")
    print("=" * 80)
    print()
    print(f"Output directory: {INTERNAL_PRESETS_DIR}")
    print(f"Total presets: {len(existing_presets) + converted_count} (22 existing + {converted_count} new)")
    print()


if __name__ == '__main__':
    main()
