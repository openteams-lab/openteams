#!/usr/bin/env python3
"""
Generate localization entries for all agent presets.

This script reads the manifest CSV and updates chat.json files
with localization entries for all agent preset names.
"""

import csv
import json
from pathlib import Path
from typing import Dict, List

# Paths
MANIFEST_PATH = Path(r"E:\workspace\projectSS\agents-chatgroup\scripts\manifest.csv")
LOCALES_DIR = Path(r"E:\workspace\projectSS\agents-chatgroup\frontend\src\i18n\locales")

# Languages to update
LANGUAGES = ['en', 'es', 'fr', 'ja', 'ko', 'zh-Hans', 'zh-Hant']


def load_agent_data() -> List[Dict]:
    """Load agent names and IDs from manifest CSV."""
    agents = []

    with open(MANIFEST_PATH, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            agents.append({
                'id': row['id'],
                'name': row['name']
            })

    return sorted(agents, key=lambda x: x['id'])


def update_chat_json(lang: str, agents: List[Dict], translations: Dict = None):
    """Update chat.json for a specific language."""
    chat_json_path = LOCALES_DIR / lang / 'chat.json'

    print(f"Updating {lang}/chat.json...")

    # Read existing chat.json
    with open(chat_json_path, 'r', encoding='utf-8') as f:
        chat_data = json.load(f)

    # Ensure structure exists
    if 'members' not in chat_data:
        chat_data['members'] = {}
    if 'presetDisplay' not in chat_data['members']:
        chat_data['members']['presetDisplay'] = {}
    if 'members' not in chat_data['members']['presetDisplay']:
        chat_data['members']['presetDisplay']['members'] = {}

    members_dict = chat_data['members']['presetDisplay']['members']

    # Add new entries
    added_count = 0
    for agent in agents:
        agent_id = agent['id']

        # Skip if already exists (for existing 22 presets)
        if agent_id in members_dict:
            continue

        if lang == 'en':
            # Use original English name
            members_dict[agent_id] = agent['name']
        else:
            # Use translation if available, otherwise English
            translation = translations.get(agent_id, agent['name']) if translations else agent['name']
            members_dict[agent_id] = translation

        added_count += 1

    # Sort the members dictionary by key for consistency
    chat_data['members']['presetDisplay']['members'] = dict(sorted(members_dict.items()))

    # Write back
    with open(chat_json_path, 'w', encoding='utf-8') as f:
        json.dump(chat_data, f, indent=2, ensure_ascii=False)
        f.write('\n')  # Trailing newline

    print(f"  Added {added_count} new entries to {lang}/chat.json")
    print(f"  Total entries: {len(members_dict)}")


def main():
    """Main execution."""
    print("=" * 80)
    print("Generate Localization Entries")
    print("=" * 80)
    print()

    # Load agent data
    agents = load_agent_data()
    print(f"Loaded {len(agents)} agent definitions from manifest")
    print()

    # Update English baseline (Phase 1)
    print("Phase 1: English Baseline")
    print("-" * 40)
    update_chat_json('en', agents)
    print()

    # Update other languages with English fallback (Phase 2)
    print("Phase 2: Other Languages (English Fallback)")
    print("-" * 40)
    for lang in ['es', 'fr', 'ja', 'ko', 'zh-Hans', 'zh-Hant']:
        update_chat_json(lang, agents)  # No translations yet, will use English
    print()

    print("=" * 80)
    print("Localization Generation Complete!")
    print("=" * 80)
    print()
    print("Next steps:")
    print("1. Run AI translation script to translate agent names")
    print("2. Update language files with translations")
    print()


if __name__ == '__main__':
    main()
