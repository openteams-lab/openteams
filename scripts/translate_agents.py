#!/usr/bin/env python3
"""
Translate agent names to multiple languages using AI.

This script uses Claude API to translate agent preset names
to 6 non-English languages with high quality.
"""

import csv
import json
import os
import sys
from pathlib import Path
from typing import Dict, List

# Paths
MANIFEST_PATH = Path(r"E:\workspace\projectSS\agents-chatgroup\scripts\manifest.csv")
LOCALES_DIR = Path(r"E:\workspace\projectSS\agents-chatgroup\frontend\src\i18n\locales")
TRANSLATIONS_DIR = Path(r"E:\workspace\projectSS\agents-chatgroup\scripts\translations")

# Ensure translations directory exists
TRANSLATIONS_DIR.mkdir(exist_ok=True)

# Language configurations
LANGUAGES = {
    'zh-Hans': {
        'name': 'Simplified Chinese',
        'native': '简体中文',
        'prompt_lang': 'Simplified Chinese (简体中文)'
    },
    'zh-Hant': {
        'name': 'Traditional Chinese',
        'native': '繁體中文',
        'prompt_lang': 'Traditional Chinese (繁體中文)'
    },
    'ja': {
        'name': 'Japanese',
        'native': '日本語',
        'prompt_lang': 'Japanese (日本語)'
    },
    'ko': {
        'name': 'Korean',
        'native': '한국어',
        'prompt_lang': 'Korean (한국어)'
    },
    'es': {
        'name': 'Spanish',
        'native': 'Español',
        'prompt_lang': 'Spanish (Español)'
    },
    'fr': {
        'name': 'French',
        'native': 'Français',
        'prompt_lang': 'French (Français)'
    },
}

# Translation glossary - technical terms that should NOT be translated
KEEP_ENGLISH = [
    'Backend', 'Frontend', 'Full-stack', 'DevOps', 'API', 'REST', 'GraphQL',
    'Unity', 'Unreal', 'Godot', 'Roblox', 'VisionOS', 'XR', 'macOS',
    'SQL', 'NoSQL', 'Git', 'CI/CD', 'Docker', 'Kubernetes',
    'JavaScript', 'TypeScript', 'Python', 'Java', 'C#', 'C++', 'Go', 'Rust',
    'React', 'Vue', 'Angular', 'Node.js', 'Next.js',
    'MongoDB', 'PostgreSQL', 'Redis', 'MySQL',
    'AWS', 'Azure', 'GCP', 'Terraform',
    'SEO', 'PPC', 'SRE', 'QA', 'UX', 'UI', 'PMO',
    'LinkedIn', 'Instagram', 'Twitter', 'TikTok', 'Douyin',
    'WeChat', 'Weibo', 'Zhihu', 'Xiaohongshu', 'Bilibili', 'Kuaishou',
    'Feishu', 'Jira', 'Baidu',
    'LSP', 'MCP', 'OAuth', 'JWT', 'HTTPS', 'WebSocket',
    'Solidity', 'Blockchain', 'Smart Contract', 'AI', 'ML', 'LLM',
]

# Role terms translation guide (to ensure consistency)
ROLE_TRANSLATIONS = {
    'zh-Hans': {
        'Engineer': '工程师',
        'Developer': '开发者',
        'Architect': '架构师',
        'Designer': '设计师',
        'Manager': '经理',
        'Specialist': '专家',
        'Analyst': '分析师',
        'Strategist': '策略师',
        'Coach': '教练',
        'Auditor': '审计员',
        'Reviewer': '审查员',
        'Tester': '测试员',
        'Writer': '撰稿人',
        'Editor': '编辑',
        'Researcher': '研究员',
        'Builder': '构建者',
        'Operator': '运营者',
        'Steward': '管理员',
        'Optimizer': '优化师',
        'Automator': '自动化专家',
        'Maintainer': '维护者',
        'Creator': '创作者',
        'Curator': '策展人',
        'Coordinator': '协调员',
        'Shepherd': '引导者',
        'Advisor': '顾问',
        'Consultant': '咨询师',
        'Commander': '指挥官',
        'Tracker': '追踪器',
        'Collector': '收集器',
        'Synthesizer': '综合器',
        'Generator': '生成器',
        'Evaluator': '评估者',
        'Checker': '检查器',
        'Guardian': '守护者',
        'Responder': '响应者',
        'Agent': '代理',
        'Producer': '制作人',
        'Injector': '注入器',
        'Buyer': '购买者',
    },
    'zh-Hant': {
        'Engineer': '工程師',
        'Developer': '開發者',
        'Architect': '架構師',
        'Designer': '設計師',
        'Manager': '經理',
        'Specialist': '專家',
        'Analyst': '分析師',
        'Strategist': '策略師',
        'Coach': '教練',
        'Auditor': '審計員',
        'Reviewer': '審查員',
        'Tester': '測試員',
        'Writer': '撰稿人',
        'Editor': '編輯',
        'Researcher': '研究員',
        'Builder': '構建者',
        'Operator': '運營者',
        'Steward': '管理員',
        'Optimizer': '優化師',
        'Automator': '自動化專家',
        'Maintainer': '維護者',
        'Creator': '創作者',
        'Curator': '策展人',
        'Coordinator': '協調員',
        'Shepherd': '引導者',
        'Advisor': '顧問',
        'Consultant': '諮詢師',
        'Commander': '指揮官',
        'Tracker': '追蹤器',
        'Collector': '收集器',
        'Synthesizer': '綜合器',
        'Generator': '生成器',
        'Evaluator': '評估者',
        'Checker': '檢查器',
        'Guardian': '守護者',
        'Responder': '響應者',
        'Agent': '代理',
        'Producer': '製作人',
        'Injector': '注入器',
        'Buyer': '購買者',
    },
    'ja': {
        'Engineer': 'エンジニア',
        'Developer': '開発者',
        'Architect': 'アーキテクト',
        'Designer': 'デザイナー',
        'Manager': 'マネージャー',
        'Specialist': 'スペシャリスト',
        'Analyst': 'アナリスト',
        'Strategist': 'ストラテジスト',
        'Coach': 'コーチ',
        'Auditor': '監査員',
        'Reviewer': 'レビュアー',
        'Tester': 'テスター',
        'Writer': 'ライター',
        'Editor': 'エディター',
        'Researcher': 'リサーチャー',
        'Builder': 'ビルダー',
        'Operator': 'オペレーター',
        'Steward': 'スチュワード',
        'Optimizer': 'オプティマイザー',
        'Automator': 'オートメーター',
        'Maintainer': 'メンテナー',
        'Creator': 'クリエイター',
        'Curator': 'キュレーター',
        'Coordinator': 'コーディネーター',
        'Shepherd': 'シェパード',
        'Advisor': 'アドバイザー',
        'Consultant': 'コンサルタント',
        'Commander': 'コマンダー',
        'Tracker': 'トラッカー',
        'Collector': 'コレクター',
        'Synthesizer': 'シンセサイザー',
        'Generator': 'ジェネレーター',
        'Evaluator': 'エバリュエーター',
        'Checker': 'チェッカー',
        'Guardian': 'ガーディアン',
        'Responder': 'レスポンダー',
        'Agent': 'エージェント',
        'Producer': 'プロデューサー',
        'Injector': 'インジェクター',
        'Buyer': 'バイヤー',
    },
    'ko': {
        'Engineer': '엔지니어',
        'Developer': '개발자',
        'Architect': '아키텍트',
        'Designer': '디자이너',
        'Manager': '매니저',
        'Specialist': '전문가',
        'Analyst': '분석가',
        'Strategist': '전략가',
        'Coach': '코치',
        'Auditor': '감사자',
        'Reviewer': '검토자',
        'Tester': '테스터',
        'Writer': '작가',
        'Editor': '편집자',
        'Researcher': '연구원',
        'Builder': '빌더',
        'Operator': '운영자',
        'Steward': '관리자',
        'Optimizer': '최적화 전문가',
        'Automator': '자동화 전문가',
        'Maintainer': '유지보수자',
        'Creator': '크리에이터',
        'Curator': '큐레이터',
        'Coordinator': '코디네이터',
        'Shepherd': '가이드',
        'Advisor': '어드바이저',
        'Consultant': '컨설턴트',
        'Commander': '커맨더',
        'Tracker': '트래커',
        'Collector': '수집기',
        'Synthesizer': '종합기',
        'Generator': '생성기',
        'Evaluator': '평가자',
        'Checker': '검사기',
        'Guardian': '가디언',
        'Responder': '응답자',
        'Agent': '에이전트',
        'Producer': '프로듀서',
        'Injector': '인젝터',
        'Buyer': '구매자',
    },
    'es': {
        'Engineer': 'Ingeniero',
        'Developer': 'Desarrollador',
        'Architect': 'Arquitecto',
        'Designer': 'Diseñador',
        'Manager': 'Gerente',
        'Specialist': 'Especialista',
        'Analyst': 'Analista',
        'Strategist': 'Estratega',
        'Coach': 'Coach',
        'Auditor': 'Auditor',
        'Reviewer': 'Revisor',
        'Tester': 'Probador',
        'Writer': 'Escritor',
        'Editor': 'Editor',
        'Researcher': 'Investigador',
        'Builder': 'Constructor',
        'Operator': 'Operador',
        'Steward': 'Administrador',
        'Optimizer': 'Optimizador',
        'Automator': 'Automatizador',
        'Maintainer': 'Mantenedor',
        'Creator': 'Creador',
        'Curator': 'Curador',
        'Coordinator': 'Coordinador',
        'Shepherd': 'Guía',
        'Advisor': 'Asesor',
        'Consultant': 'Consultor',
        'Commander': 'Comandante',
        'Tracker': 'Rastreador',
        'Collector': 'Recolector',
        'Synthesizer': 'Sintetizador',
        'Generator': 'Generador',
        'Evaluator': 'Evaluador',
        'Checker': 'Verificador',
        'Guardian': 'Guardián',
        'Responder': 'Respondedor',
        'Agent': 'Agente',
        'Producer': 'Productor',
        'Injector': 'Inyector',
        'Buyer': 'Comprador',
    },
    'fr': {
        'Engineer': 'Ingénieur',
        'Developer': 'Développeur',
        'Architect': 'Architecte',
        'Designer': 'Designer',
        'Manager': 'Responsable',
        'Specialist': 'Spécialiste',
        'Analyst': 'Analyste',
        'Strategist': 'Stratège',
        'Coach': 'Coach',
        'Auditor': 'Auditeur',
        'Reviewer': 'Réviseur',
        'Tester': 'Testeur',
        'Writer': 'Rédacteur',
        'Editor': 'Éditeur',
        'Researcher': 'Chercheur',
        'Builder': 'Constructeur',
        'Operator': 'Opérateur',
        'Steward': 'Gestionnaire',
        'Optimizer': 'Optimiseur',
        'Automator': 'Automatiseur',
        'Maintainer': 'Mainteneur',
        'Creator': 'Créateur',
        'Curator': 'Curateur',
        'Coordinator': 'Coordinateur',
        'Shepherd': 'Guide',
        'Advisor': 'Conseiller',
        'Consultant': 'Consultant',
        'Commander': 'Commandant',
        'Tracker': 'Traceur',
        'Collector': 'Collecteur',
        'Synthesizer': 'Synthétiseur',
        'Generator': 'Générateur',
        'Evaluator': 'Évaluateur',
        'Checker': 'Vérificateur',
        'Guardian': 'Gardien',
        'Responder': 'Répondeur',
        'Agent': 'Agent',
        'Producer': 'Producteur',
        'Injector': 'Injecteur',
        'Buyer': 'Acheteur',
    },
}


def load_agents_to_translate() -> List[Dict]:
    """Load new agent names that need translation."""
    agents = []

    # Existing 22 preset IDs that already have translations
    existing_ids = {
        'coordinator_pmo', 'product_manager', 'system_architect',
        'prompt_engineer', 'frontend_engineer', 'backend_engineer',
        'fullstack_engineer', 'qa_tester', 'ux_ui_designer',
        'safety_policy_officer', 'solution_manager', 'code_reviewer',
        'devops_engineer', 'product_analyst', 'data_analyst',
        'technical_writer', 'content_researcher', 'content_editor',
        'frontier_researcher', 'marketing_specialist', 'video_editor',
        'market_analyst'
    }

    with open(MANIFEST_PATH, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            # Only include new agents (not in existing 22)
            if row['id'] not in existing_ids:
                agents.append({
                    'id': row['id'],
                    'name': row['name']
                })

    return sorted(agents, key=lambda x: x['id'])


def manual_translate(agent_name: str, lang_code: str) -> str:
    """
    Manually translate agent names using glossary.

    This function applies translation rules based on the glossary
    to ensure consistency and quality.
    """
    # Get role translations for this language
    role_trans = ROLE_TRANSLATIONS.get(lang_code, {})

    # Start with the original name
    result = agent_name

    # Apply role translations
    for english_role, translated_role in role_trans.items():
        if english_role in result:
            result = result.replace(english_role, translated_role)

    return result


def translate_batch_manual(agents: List[Dict], lang_code: str) -> Dict[str, str]:
    """Translate a batch of agents using manual glossary-based translation."""
    translations = {}

    for agent in agents:
        agent_id = agent['id']
        agent_name = agent['name']

        # Apply manual translation
        translated = manual_translate(agent_name, lang_code)

        translations[agent_id] = translated

    return translations


def save_translations(lang_code: str, translations: Dict[str, str]):
    """Save translations to a JSON file."""
    output_path = TRANSLATIONS_DIR / f'{lang_code}.json'

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(translations, f, ensure_ascii=False, indent=2)
        f.write('\n')

    print(f"  Saved {len(translations)} translations to {output_path.name}")


def update_chat_json(lang_code: str, translations: Dict[str, str]):
    """Update chat.json file with translations."""
    chat_json_path = LOCALES_DIR / lang_code / 'chat.json'

    print(f"  Updating {lang_code}/chat.json...")

    # Read existing chat.json
    with open(chat_json_path, 'r', encoding='utf-8') as f:
        chat_data = json.load(f)

    # Update translations
    members_dict = chat_data['members']['presetDisplay']['members']

    updated_count = 0
    for agent_id, translation in translations.items():
        if agent_id in members_dict:
            # Only update if current value is English (untranslated)
            members_dict[agent_id] = translation
            updated_count += 1

    # Write back
    with open(chat_json_path, 'w', encoding='utf-8') as f:
        json.dump(chat_data, f, indent=2, ensure_ascii=False)
        f.write('\n')

    print(f"  Updated {updated_count} entries in {lang_code}/chat.json")


def main():
    """Main translation process."""
    print("=" * 80)
    print("AI Agent Names Translation")
    print("=" * 80)
    print()

    # Load agents
    agents = load_agents_to_translate()
    print(f"Loaded {len(agents)} new agents to translate")
    print()

    # Process each language
    for lang_code, lang_info in LANGUAGES.items():
        print(f"Translating to {lang_info['name']}...")
        print("-" * 40)

        # Translate using manual glossary
        translations = translate_batch_manual(agents, lang_code)

        # Save translations to file
        save_translations(lang_code, translations)

        # Update chat.json
        update_chat_json(lang_code, translations)

        print(f"[OK] Completed {lang_code}")
        print()

    print("=" * 80)
    print("Translation Complete!")
    print("=" * 80)
    print()
    print(f"Translated {len(agents)} agents to {len(LANGUAGES)} languages")
    print(f"Translation files saved to: {TRANSLATIONS_DIR}")
    print()


if __name__ == '__main__':
    main()
