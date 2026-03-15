#!/usr/bin/env python3
"""
Update skills_registry.json by scanning all skill directories.

This script:
1. Scans all subdirectories in the skills folder
2. Reads SKILL.md from each directory
3. Parses YAML front matter for metadata
4. Generates skills_registry.json

Usage:
    python update_registry.py [--output skills_registry.json]
"""

import argparse
import hashlib
import json
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any


def parse_front_matter(content: str) -> dict[str, Any] | None:
    """Parse YAML front matter from markdown content."""
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n", content, re.DOTALL)
    if not match:
        return None

    front_matter_str = match.group(1)
    result = {}

    for line in front_matter_str.split("\n"):
        if ":" in line:
            key, value = line.split(":", 1)
            key = key.strip()
            value = value.strip()

            # Remove quotes if present
            if (value.startswith('"') and value.endswith('"')) or (
                value.startswith("'") and value.endswith("'")
            ):
                value = value[1:-1]

            # Parse arrays (e.g., allowed-tools: Bash(...), Bash(...))
            if key == "allowed-tools":
                tools = re.findall(r"Bash\(([^)]+)\)", value)
                result[key] = tools
            else:
                result[key] = value

    return result


def generate_skill_id(name: str) -> str:
    """Generate a short unique ID for a skill based on its name."""
    return hashlib.md5(name.encode()).hexdigest()[:12]


def infer_category(name: str, description: str) -> str:
    """Infer skill category from name and description."""
    name_lower = name.lower()
    desc_lower = description.lower()

    # Category keywords mapping
    categories = {
        "Development": [
            "development",
            "code",
            "programming",
            "git",
            "test",
            "debug",
            "mcp",
            "api",
            "build",
        ],
        "Design": ["design", "ui", "ux", "visual", "brand", "canvas", "creative"],
        "Creative": ["art", "image", "video", "audio", "media", "enhancer"],
        "Writing": ["write", "content", "document", "blog", "article", "changelog"],
        "Marketing": ["marketing", "seo", "ads", "social", "lead", "growth"],
        "Sales": ["sales", "crm", "deal", "pipeline", "prospect"],
        "Business": [
            "business",
            "invoice",
            "finance",
            "accounting",
            "domain",
            "entrepreneur",
        ],
        "Productivity": [
            "productivity",
            "organize",
            "automate",
            "schedule",
            "calendar",
            "meeting",
        ],
        "Communication": [
            "communication",
            "email",
            "slack",
            "messaging",
            "chat",
            "comms",
        ],
        "Collaboration": ["collaboration", "team", "share", "sync"],
        "Integration": ["integration", "connect", "api", "sync", "webhook"],
        "Document Processing": ["document", "pdf", "xlsx", "excel", "word", "parse"],
        "App Automation": ["automation", "browser", "scrape", "extract", "workflow"],
        "Utility": ["utility", "tool", "helper", "convert", "format"],
    }

    for category, keywords in categories.items():
        for keyword in keywords:
            if keyword in name_lower or keyword in desc_lower:
                return category

    return "Utility"


def infer_compatible_agents(
    name: str, description: str, allowed_tools: list[str] | None
) -> list[str]:
    """Infer compatible agents based on skill characteristics."""
    # Default compatible agents for most skills
    default_agents = ["codex", "opencode", "cursor", "claude-code", "qwen-code"]

    name_lower = name.lower()
    desc_lower = description.lower()

    # Skills that only work with claude-code
    claude_only_keywords = ["claude-code", "claude code", "anthropic", "internal-comms"]
    for keyword in claude_only_keywords:
        if keyword in name_lower or keyword in desc_lower:
            return ["claude-code"]

    return default_agents


def infer_tags(name: str, category: str, description: str) -> list[str]:
    """Infer tags from skill metadata."""
    tags = []

    # Category-based tags
    category_tags = {
        "Development": "development",
        "Design": "design",
        "Creative": "creative",
        "Writing": "writing",
        "Marketing": "marketing",
        "Sales": "sales",
        "Business": "business",
        "Productivity": "productivity",
        "Communication": "communication",
        "Collaboration": "collaboration",
        "Integration": "integration",
        "Document Processing": "document",
        "App Automation": "automation",
        "Utility": "utility",
    }

    if category in category_tags:
        tags.append(category_tags[category])

    # Add additional tags based on keywords
    desc_lower = description.lower()

    tag_keywords = {
        "code": "code",
        "programming": "programming",
        "api": "api",
        "automation": "automation",
        "content": "content",
        "media": "media",
        "social": "social",
        "crm": "crm",
        "workflow": "workflow",
        "efficiency": "efficiency",
        "tools": "tools",
        "helper": "helper",
        "connection": "connection",
        "messaging": "messaging",
        "documentation": "documentation",
        "visual": "visual",
        "growth": "growth",
        "leads": "leads",
    }

    for keyword, tag in tag_keywords.items():
        if keyword in desc_lower and tag not in tags:
            tags.append(tag)

    return tags[:3]  # Limit to 3 tags


def scan_skills(skills_dir: Path) -> list[dict[str, Any]]:
    """Scan all skill directories and return skill metadata."""
    skills = []

    for item in sorted(skills_dir.iterdir()):
        if not item.is_dir():
            continue

        skill_md = item / "SKILL.md"
        if not skill_md.exists():
            continue

        try:
            content = skill_md.read_text(encoding="utf-8")
            front_matter = parse_front_matter(content)

            if not front_matter or "name" not in front_matter:
                print(f"Warning: No valid front matter in {skill_md}")
                continue

            name = front_matter.get("name", item.name)
            description = front_matter.get("description", "")
            allowed_tools = front_matter.get("allowed-tools", [])

            # Infer metadata
            category = front_matter.get("category") or infer_category(name, description)
            compatible_agents = front_matter.get(
                "compatible-agents"
            ) or infer_compatible_agents(name, description, allowed_tools)
            tags = front_matter.get("tags") or infer_tags(name, category, description)

            skill = {
                "id": generate_skill_id(name),
                "name": name,
                "description": description,
                "category": category,
                "version": front_matter.get("version", "1.0.0"),
                "author": front_matter.get("author", "ComposioHQ"),
                "tags": tags,
                "compatible_agents": compatible_agents,
                "source_url": front_matter.get(
                    "source_url",
                    f"https://github.com/ComposioHQ/awesome-claude-skills/tree/master/{name}",
                ),
                "content": content,
            }

            skills.append(skill)
            print(f"Processed: {name}")

        except Exception as e:
            print(f"Error processing {skill_md}: {e}")

    return skills


def generate_registry(skills: list[dict[str, Any]]) -> dict[str, Any]:
    """Generate the skills registry structure."""
    # Extract unique categories
    categories = sorted(set(skill["category"] for skill in skills))

    return {
        "generated_at": datetime.now().isoformat(),
        "total_skills": len(skills),
        "categories": categories,
        "skills": skills,
    }


def main():
    parser = argparse.ArgumentParser(description="Update skills registry JSON")
    parser.add_argument(
        "--output",
        "-o",
        default="skills_registry.json",
        help="Output JSON file path (default: skills_registry.json)",
    )
    parser.add_argument(
        "--skills-dir",
        "-d",
        default=".",
        help="Skills directory to scan (default: current directory)",
    )
    args = parser.parse_args()

    skills_dir = Path(args.skills_dir)
    output_path = skills_dir / args.output

    if not skills_dir.exists():
        print(f"Error: Skills directory not found: {skills_dir}")
        return 1

    print(f"Scanning skills in: {skills_dir}")
    skills = scan_skills(skills_dir)

    if not skills:
        print("No skills found!")
        return 1

    registry = generate_registry(skills)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(registry, f, indent=2, ensure_ascii=False)

    print(f"\nGenerated: {output_path}")
    print(f"Total skills: {len(skills)}")
    print(f"Categories: {len(registry['categories'])}")

    return 0


if __name__ == "__main__":
    exit(main())
