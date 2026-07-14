---
id: ai_prompt_quality_team
name: Équipe qualité des invites d'IA
description: Conception d'invites, tests adverses et renforcement des règles pour l'exécution des rôles.
workflow_steps:
- title: Définir les critères d'évaluation
  description: Aligner les indicateurs de réussite, les échecs, les limites de sûreté et les cas de régression.
- title: Concevoir les invites
  description: Rédiger les consignes de rôle, garde-fous, exemples et raisons de révision.
- title: Tester l'adversarial, la régression et la sûreté
  description: Couvrir les cas limites, échecs connus, risques de règle et scénarios reproductibles.
- title: Revoir les preuves et finaliser
  description: Comparer les résultats, noter les régressions, consigner les décisions et publier la version retenue.
---

Améliorer la fiabilité des invites par itération adverse.
- L'ingénierie des invites possède la structure des invites, les critères d'évaluation et la justification des révisions.
- La qualité et l'ingénierie reproduisent les échecs avec des cas concrets et des contrôles de régression.
- La sûreté bloque les changements qui introduisent des violations de règles, des fuites ou des risques de contournement.
- L'équipe consigne les preuves de chaque changement d'invite, y compris ce qui s'est amélioré et ce qui a régressé.
