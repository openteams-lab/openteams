from __future__ import annotations

import re
from pathlib import Path

import yaml


ROOT = Path("crates/services/src/services/config/presets/protocol")
LANGUAGES = ("en", "zh", "ja", "ko", "fr", "es")
TRANSLATED_KEYS = {"id", "name", "description", "workflow_steps"}
ENGLISH_KEYS = TRANSLATED_KEYS | {"member_ids", "tier", "enabled"}
EXPECTED_TEMPLATES = {
    "ai_prompt_quality_team": 4,
    "architecture_governance_team": 4,
    "content_studio_team": 4,
    "fullstack_delivery_team": 5,
    "growth_marketing_team": 4,
    "product_discovery_team": 4,
    "rapid_bugfix_team": 4,
    "research_innovation_team": 5,
    "advanced-release-command": 4,
    "advanced-growth-ops": 4,
}
EXPECTED_ADVANCED = {"advanced-release-command", "advanced-growth-ops"}
EXPECTED_LEADS = {
    "advanced-release-command": "coordinator_pmo",
    "advanced-growth-ops": "product_manager",
}
PLACEHOLDERS = re.compile(r"\b(TODO|TBD|FIXME|PLACEHOLDER|待补|占位)\b", re.IGNORECASE)
REQUIRED_LANGUAGE_MARKERS = {
    "zh": re.compile(r"[\u4e00-\u9fff]"),
    "ja": re.compile(r"[\u3040-\u30ff]"),
    "ko": re.compile(r"[\uac00-\ud7af]"),
}
BODY_REQUIRED_TERMS = {
    "ai_prompt_quality_team": {
        "zh": ["提示词工程", "质量验证和工程人员", "安全负责人", "证据"],
        "ja": ["プロンプト設計", "品質検証とエンジニアリング", "安全担当", "証拠"],
        "ko": ["프롬프트 엔지니어링", "품질 검증과 엔지니어링", "안전 담당자", "증거"],
        "fr": ["L'ingénierie des invites", "La qualité et l'ingénierie", "La sûreté", "preuves"],
        "es": ["ingeniería de instrucciones", "Calidad e ingeniería", "Seguridad", "evidencia"],
    },
    "architecture_governance_team": {
        "zh": ["目标状态方案", "实现成本", "可维护性", "上线前置条件"],
        "ja": ["目標状態の提案", "実装コスト", "保守性", "展開前提条件"],
        "ko": ["목표 상태 제안", "구현 비용", "유지보수성", "출시 선행 조건"],
        "fr": ["proposition d'état cible", "coût de mise en œuvre", "maintenabilité", "prérequis de déploiement"],
        "es": ["propuesta de estado objetivo", "costo de implementación", "mantenibilidad", "requisitos previos de despliegue"],
    },
    "content_studio_team": {
        "zh": ["主张、引用和竞争表述", "事实一致性", "不扭曲核心信息", "已知风险"],
        "ja": ["主張、参照、競合", "事実の一貫性", "中心メッセージを歪めず", "既知のリスク"],
        "ko": ["주장, 참고 자료, 경쟁", "사실 일관성", "핵심 메시지를 왜곡하지 않고", "알려진 위험"],
        "fr": ["affirmations, références", "cohérence factuelle", "sans déformer le message central", "risques connus"],
        "es": ["afirmaciones, referencias", "coherencia factual", "sin distorsionar el mensaje central", "riesgos conocidos"],
    },
    "fullstack_delivery_team": {
        "zh": ["`@` 用户", "`.openteams/plan.md`", "只有计划负责人可以编辑", "通知计划负责人", "500 个字符"],
        "ja": ["`@` できる", "`.openteams/plan.md`", "編集できるのは計画担当だけ", "計画担当に知らせ", "500 文字"],
        "ko": ["`@` 할 수", "`.openteams/plan.md`", "계획 책임자만 편집", "계획 책임자에게 알리고", "500자"],
        "fr": ["`@` directement", "`.openteams/plan.md`", "seul le responsable de planification peut le modifier", "informe le responsable de planification", "500 caractères"],
        "es": ["`@` directamente", "`.openteams/plan.md`", "solo el responsable de planificación puede editarlo", "avisar al responsable de planificación", "500 caracteres"],
    },
    "growth_marketing_team": {
        "zh": ["营销活动目标", "漏斗指标", "创意变体", "投资回报率"],
        "ja": ["施策目標", "ファネル指標", "創意案", "投資対効果"],
        "ko": ["캠페인 목표", "퍼널 지표", "창의 변형", "투자 수익률"],
        "fr": ["objectif de campagne", "indicateur de tunnel", "variantes créatives", "retour sur investissement"],
        "es": ["objetivo de campaña", "métrica de embudo", "variantes creativas", "retorno de inversión"],
    },
    "product_discovery_team": {
        "zh": ["决策期限", "已观察信号与假设", "最小且有用", "测量计划"],
        "ja": ["判断期限", "観測された信号と仮定", "最小で有用", "測定計画"],
        "ko": ["결정 기한", "관찰된 신호와 가정", "가장 작은 유용한", "측정 계획"],
        "fr": ["échéance de décision", "signaux observés des hypothèses", "plus petite expérience utile", "plan de mesure"],
        "es": ["fecha límite de decisión", "señales observadas de supuestos", "experimento útil más pequeño", "plan de medición"],
    },
    "rapid_bugfix_team": {
        "zh": ["严重程度", "目标恢复时间", "最小安全修复", "关键回归路径", "防护措施"],
        "ja": ["重大度", "目標復旧時間", "最小で安全な修正", "重要な回帰経路", "保護策"],
        "ko": ["심각도", "목표 복구 시간", "가장 작은 안전한 수정", "핵심 회귀 경로", "보호 조치"],
        "fr": ["sévérité", "délai cible de rétablissement", "plus petite correction sûre", "chemin de régression critique", "protections"],
        "es": ["severidad", "tiempo objetivo de recuperación", "corrección segura más pequeña", "ruta crítica de regresión", "salvaguardas"],
    },
    "research_innovation_team": {
        "zh": ["探索命题", "停止条件", "基于证据而非新奇性", "信号质量", "值得投入"],
        "ja": ["探索命題", "停止条件", "新しさではなく証拠", "信号品質", "資金を投じる価値"],
        "ko": ["탐색 명제", "중단 조건", "새로움이 아니라 증거", "신호 품질", "투자할 가치"],
        "fr": ["thèse d'exploration", "conditions d'arrêt", "preuves plutôt qu'avec la nouveauté", "qualité des signaux", "paris à financer"],
        "es": ["tesis de exploración", "condiciones de parada", "evidencia en lugar de novedad", "calidad de señales", "apuestas que vale la pena financiar"],
    },
    "advanced-release-command": {
        "zh": ["指挥中心", "上线/不上线决策", "关键回归", "发布说明", "事件和后续负责人"],
        "ja": ["指揮センター", "公開可否の判断", "重要な回帰", "公開メモ", "事件、後続担当者"],
        "ko": ["지휘 센터", "출시 여부 결정", "핵심 회귀", "릴리스 노트", "사고, 후속 담당자"],
        "fr": ["centre de commandement", "décisions de lancement ou d'arrêt", "régressions critiques", "notes de version", "incidents et les responsables"],
        "es": ["centro de mando", "decisiones de lanzar o no lanzar", "regresiones críticas", "notas de lanzamiento", "incidentes y responsables"],
    },
    "advanced-growth-ops": {
        "zh": ["实验系统", "决策阈值", "归因质量", "不偏离实验意图", "学习记录"],
        "ja": ["実験システム", "判断しきい値", "貢献度の品質", "実験意図を失わず", "学習記録"],
        "ko": ["실험 시스템", "결정 기준", "기여도 품질", "실험 의도를 잃지 않으면서", "학습 기록"],
        "fr": ["système d'expérimentation", "seuil de décision", "qualité de l'attribution", "sans perdre l'intention", "journal d'apprentissage"],
        "es": ["sistema disciplinado de experimentos", "umbral de decisión", "calidad de atribución", "sin perder la intención", "registro de aprendizaje"],
    },
}


def parse_markdown(path: Path) -> tuple[dict, str]:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        raise AssertionError(f"{path}: missing opening frontmatter delimiter")
    try:
        _, frontmatter, body = text.split("---\n", 2)
    except ValueError as exc:
        raise AssertionError(f"{path}: missing closing frontmatter delimiter") from exc
    data = yaml.safe_load(frontmatter)
    if not isinstance(data, dict):
        raise AssertionError(f"{path}: frontmatter must be a mapping")
    return data, body.strip()


def validate() -> None:
    root_markdown = sorted(path.name for path in ROOT.glob("*.md"))
    if root_markdown != ["team_collaboration_protocol.md"]:
        raise AssertionError(f"root protocol markdown should only contain the shared protocol, got {root_markdown}")

    role_ids = {path.stem for path in ROOT.parent.joinpath("roles").glob("*.md")}
    by_language: dict[str, set[str]] = {}
    english_by_id: dict[str, dict] = {}
    english_body_by_id: dict[str, str] = {}

    for language in LANGUAGES:
        language_dir = ROOT / language
        if not language_dir.is_dir():
            raise AssertionError(f"{language_dir}: missing language directory")
        files = sorted(language_dir.glob("*.md"))
        if len(files) != len(EXPECTED_TEMPLATES):
            raise AssertionError(f"{language_dir}: expected 10 template files, got {len(files)}")

        ids: set[str] = set()
        for path in files:
            data, body = parse_markdown(path)
            template_id = data.get("id")
            if template_id not in EXPECTED_TEMPLATES:
                raise AssertionError(f"{path}: unexpected id {template_id!r}")
            if path.stem != template_id:
                raise AssertionError(f"{path}: file stem must match id {template_id!r}")
            if template_id in ids:
                raise AssertionError(f"{language_dir}: duplicate id {template_id}")
            ids.add(template_id)

            expected_keys = ENGLISH_KEYS if language == "en" else TRANSLATED_KEYS
            if language == "en" and template_id in EXPECTED_LEADS:
                expected_keys = expected_keys | {"lead_member_id"}
            if set(data) != expected_keys:
                raise AssertionError(f"{path}: expected frontmatter keys {sorted(expected_keys)}, got {sorted(data)}")

            if not isinstance(data["name"], str) or not data["name"].strip():
                raise AssertionError(f"{path}: name must be non-empty")
            if not isinstance(data["description"], str) or not data["description"].strip():
                raise AssertionError(f"{path}: description must be non-empty")
            if not body:
                raise AssertionError(f"{path}: body must be non-empty")
            if PLACEHOLDERS.search(body) or PLACEHOLDERS.search(data["name"]) or PLACEHOLDERS.search(data["description"]):
                raise AssertionError(f"{path}: placeholder text found")

            workflow_steps = data["workflow_steps"]
            if not isinstance(workflow_steps, list) or len(workflow_steps) != EXPECTED_TEMPLATES[template_id]:
                raise AssertionError(f"{path}: unexpected workflow step count")
            for index, step in enumerate(workflow_steps, start=1):
                if set(step) != {"title", "description"}:
                    raise AssertionError(f"{path}: step {index} must contain title and description")
                if not str(step["title"]).strip() or not str(step["description"]).strip():
                    raise AssertionError(f"{path}: step {index} title and description must be non-empty")

            if language == "en":
                english_by_id[template_id] = data
                english_body_by_id[template_id] = body
                tier = "advanced" if template_id in EXPECTED_ADVANCED else "standard"
                if data["tier"] != tier:
                    raise AssertionError(f"{path}: expected tier {tier!r}")
                if data["enabled"] is not True:
                    raise AssertionError(f"{path}: enabled must be true")
                member_ids = data["member_ids"]
                if not isinstance(member_ids, list) or not member_ids:
                    raise AssertionError(f"{path}: member_ids must be a non-empty list")
                missing_roles = [member_id for member_id in member_ids if member_id not in role_ids]
                if missing_roles:
                    raise AssertionError(f"{path}: unknown member_ids {missing_roles}")
                expected_lead = EXPECTED_LEADS.get(template_id)
                if expected_lead and data.get("lead_member_id") != expected_lead:
                    raise AssertionError(f"{path}: expected lead_member_id {expected_lead!r}")
                if expected_lead and expected_lead not in member_ids:
                    raise AssertionError(f"{path}: lead_member_id must be included in member_ids")
            else:
                required_marker = REQUIRED_LANGUAGE_MARKERS.get(language)
                localized_text = "\n".join(
                    [data["name"], data["description"], body]
                    + [step["title"] + "\n" + step["description"] for step in workflow_steps]
                )
                if required_marker and not required_marker.search(localized_text):
                    raise AssertionError(f"{path}: target language characters were not found")
                required_terms = BODY_REQUIRED_TERMS[template_id][language]
                missing_terms = [term for term in required_terms if term not in body]
                if missing_terms:
                    raise AssertionError(f"{path}: missing localized protocol terms {missing_terms}")
                english_body = english_body_by_id.get(template_id)
                if english_body:
                    english_bullets = [line for line in english_body.splitlines() if line.startswith("- ")]
                    localized_bullets = [line for line in body.splitlines() if line.startswith("- ")]
                    if len(localized_bullets) != len(english_bullets):
                        raise AssertionError(
                            f"{path}: expected {len(english_bullets)} protocol bullets, got {len(localized_bullets)}"
                        )
                english = english_by_id.get(template_id)
                if english:
                    if data["name"] == english["name"] or data["description"] == english["description"]:
                        raise AssertionError(f"{path}: translated name or description matches English")
                    for index, step in enumerate(workflow_steps):
                        english_step = english["workflow_steps"][index]
                        if step["title"] == english_step["title"] or step["description"] == english_step["description"]:
                            raise AssertionError(f"{path}: translated step {index + 1} matches English")

        if ids != set(EXPECTED_TEMPLATES):
            raise AssertionError(f"{language_dir}: id set mismatch")
        by_language[language] = ids

    baseline = by_language["en"]
    for language, ids in by_language.items():
        if ids != baseline:
            raise AssertionError(f"{language}: ids do not match English baseline")

    print("validated 60 localized team template files")


if __name__ == "__main__":
    validate()
