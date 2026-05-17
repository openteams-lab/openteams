use std::collections::{HashMap, HashSet};

use db::models::workflow_types::WorkflowPlanJson;

/// 校验错误，包含人类可读的中文错误信息
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ValidationError {
    pub field: String,
    pub message: String,
}

/// 校验结果
#[derive(Debug, Clone)]
pub struct ValidationResult {
    pub is_valid: bool,
    pub errors: Vec<ValidationError>,
}

impl ValidationResult {
    pub fn ok() -> Self {
        Self {
            is_valid: true,
            errors: vec![],
        }
    }

    pub fn with_errors(errors: Vec<ValidationError>) -> Self {
        Self {
            is_valid: errors.is_empty(),
            errors,
        }
    }
}

// ---------------------------------------------------------------------------
// 结构校验 (Structural Validation)
// ---------------------------------------------------------------------------

/// 对 workflow plan JSON 做结构校验：必填字段、唯一性、基本类型约束
pub fn validate_structure(plan: &WorkflowPlanJson) -> ValidationResult {
    let mut errors = Vec::new();

    // version 必须为 1
    match plan.plan_schema_version() {
        Ok(1) => {}
        Ok(_) => {
            errors.push(ValidationError {
                field: "version".into(),
                message: format!("计划版本号必须为 1，当前值为 {}", plan.version),
            });
        }
        Err(message) => {
            errors.push(ValidationError {
                field: "version".into(),
                message,
            });
        }
    }

    // title 非空
    if plan.title.trim().is_empty() {
        errors.push(ValidationError {
            field: "title".into(),
            message: "计划标题不能为空".into(),
        });
    }

    // goal 非空
    if plan.goal.trim().is_empty() {
        errors.push(ValidationError {
            field: "goal".into(),
            message: "任务目标不能为空".into(),
        });
    }

    // agents.lead 非空
    if plan.agents.lead.trim().is_empty() {
        errors.push(ValidationError {
            field: "agents.lead".into(),
            message: "Lead agent 标识不能为空".into(),
        });
    }

    if plan.agents.available.is_empty() {
        errors.push(ValidationError {
            field: "agents.available".into(),
            message: "可用团队成员列表不能为空".into(),
        });
    }

    let mut available_agent_ids = HashSet::new();
    for agent_id in &plan.agents.available {
        if agent_id.trim().is_empty() {
            errors.push(ValidationError {
                field: "agents.available".into(),
                message: "可用团队成员标识不能为空".into(),
            });
            continue;
        }

        if !available_agent_ids.insert(agent_id) {
            errors.push(ValidationError {
                field: "agents.available".into(),
                message: format!("可用团队成员标识 '{}' 重复", agent_id),
            });
        }
    }

    // nodes 非空
    if plan.nodes.is_empty() {
        errors.push(ValidationError {
            field: "nodes".into(),
            message: "节点列表不能为空".into(),
        });
    }

    // 节点 id 唯一性
    let mut node_ids = HashSet::new();
    for node in &plan.nodes {
        if !node_ids.insert(&node.id) {
            errors.push(ValidationError {
                field: format!("nodes[id={}]", node.id),
                message: format!("节点 id '{}' 重复，所有节点 id 必须唯一", node.id),
            });
        }
    }

    // 节点 type 必须是 workflowStep
    for node in &plan.nodes {
        if node.node_type != "workflowStep" {
            errors.push(ValidationError {
                field: format!("nodes[id={}].type", node.id),
                message: format!(
                    "节点类型必须为 'workflowStep'，当前值为 '{}'",
                    node.node_type
                ),
            });
        }
    }

    // 节点 data.stepType 必须是 task/review/result
    let valid_step_types = ["task", "review", "result"];
    for node in &plan.nodes {
        if !valid_step_types.contains(&node.data.step_type.as_str()) {
            errors.push(ValidationError {
                field: format!("nodes[id={}].data.stepType", node.id),
                message: format!(
                    "步骤类型必须为 task、review 或 result，当前值为 '{}'",
                    node.data.step_type
                ),
            });
        }
    }

    // 节点 data.title 非空
    for node in &plan.nodes {
        if node.data.title.trim().is_empty() {
            errors.push(ValidationError {
                field: format!("nodes[id={}].data.title", node.id),
                message: format!("节点 '{}' 的标题不能为空", node.id),
            });
        }
    }

    // 节点 data.instructions 非空
    for node in &plan.nodes {
        if node.data.instructions.trim().is_empty() {
            errors.push(ValidationError {
                field: format!("nodes[id={}].data.instructions", node.id),
                message: format!("节点 '{}' 的指令不能为空", node.id),
            });
        }
    }

    // 边 id 唯一性
    let mut edge_ids = HashSet::new();
    for edge in &plan.edges {
        if !edge_ids.insert(&edge.id) {
            errors.push(ValidationError {
                field: format!("edges[id={}]", edge.id),
                message: format!("边 id '{}' 重复，所有边 id 必须唯一", edge.id),
            });
        }
    }

    // step_key（即 node.id）唯一性已在上面的 node id 唯一性检查中覆盖

    ValidationResult::with_errors(errors)
}

// ---------------------------------------------------------------------------
// 语义校验 (Semantic Validation)
// ---------------------------------------------------------------------------

/// 对 workflow plan JSON 做语义校验：DAG、agent 引用、result 节点约束
pub fn validate_semantics(plan: &WorkflowPlanJson, valid_agent_ids: &[String]) -> ValidationResult {
    let mut errors = Vec::new();
    let node_ids: HashSet<&str> = plan.nodes.iter().map(|n| n.id.as_str()).collect();

    // 边端点必须引用存在的节点
    for edge in &plan.edges {
        if !node_ids.contains(edge.source.as_str()) {
            errors.push(ValidationError {
                field: format!("edges[id={}].source", edge.id),
                message: format!(
                    "边 '{}' 的源节点 '{}' 不存在于节点列表中",
                    edge.id, edge.source
                ),
            });
        }
        if !node_ids.contains(edge.target.as_str()) {
            errors.push(ValidationError {
                field: format!("edges[id={}].target", edge.id),
                message: format!(
                    "边 '{}' 的目标节点 '{}' 不存在于节点列表中",
                    edge.id, edge.target
                ),
            });
        }
    }

    // DAG 无环检测
    if let Some(cycle_msg) = detect_cycle(plan) {
        errors.push(ValidationError {
            field: "edges".into(),
            message: cycle_msg,
        });
    }

    // 恰好一个 result 节点
    let result_nodes: Vec<&str> = plan
        .nodes
        .iter()
        .filter(|n| n.data.step_type == "result")
        .map(|n| n.id.as_str())
        .collect();

    if result_nodes.is_empty() {
        errors.push(ValidationError {
            field: "nodes".into(),
            message: "计划中必须包含且只能包含一个 result（结果）节点".into(),
        });
    } else if result_nodes.len() > 1 {
        errors.push(ValidationError {
            field: "nodes".into(),
            message: format!(
                "计划中只能有一个 result 节点，但发现了 {} 个: {}",
                result_nodes.len(),
                result_nodes.join(", ")
            ),
        });
    }

    // result 节点不能有出边
    if let Some(result_id) = result_nodes.first() {
        let has_outgoing = plan.edges.iter().any(|e| e.source == *result_id);
        if has_outgoing {
            errors.push(ValidationError {
                field: format!("nodes[id={}]", result_id),
                message: format!("Result 节点 '{}' 不能有出边（后继节点）", result_id),
            });
        }
    }

    // agent 引用校验
    let agent_set: HashSet<&str> = valid_agent_ids.iter().map(|s| s.as_str()).collect();
    let available_agent_set: HashSet<&str> =
        plan.agents.available.iter().map(|s| s.as_str()).collect();

    for agent_id in &plan.agents.available {
        if !agent_set.contains(agent_id.as_str()) {
            errors.push(ValidationError {
                field: "agents.available".into(),
                message: format!(
                    "可用团队成员 '{}' 不在当前 session 的可用成员列表中",
                    agent_id
                ),
            });
        }
    }

    for node in &plan.nodes {
        if let Some(ref agent_id) = node.data.agent_id {
            if !agent_id.is_empty() && !agent_set.contains(agent_id.as_str()) {
                errors.push(ValidationError {
                    field: format!("nodes[id={}].data.agentId", node.id),
                    message: format!(
                        "节点 '{}' 引用的 agent '{}' 不在可用团队成员列表中",
                        node.id, agent_id
                    ),
                });
            } else if !agent_id.is_empty() && !available_agent_set.contains(agent_id.as_str()) {
                errors.push(ValidationError {
                    field: format!("nodes[id={}].data.agentId", node.id),
                    message: format!(
                        "节点 '{}' 引用的 agent '{}' 不在 agents.available 列表中",
                        node.id, agent_id
                    ),
                });
            }
        }
    }

    // lead 必须在 valid_agent_ids 中
    if !agent_set.contains(plan.agents.lead.as_str()) {
        errors.push(ValidationError {
            field: "agents.lead".into(),
            message: format!("Lead agent '{}' 不在可用团队成员列表中", plan.agents.lead),
        });
    }

    // edge data.kind 校验
    for edge in &plan.edges {
        if let Some(ref data) = edge.data
            && data.kind != "hard"
            && data.kind != "soft"
        {
            errors.push(ValidationError {
                field: format!("edges[id={}].data.kind", edge.id),
                message: format!(
                    "边的依赖类型必须为 'hard' 或 'soft'，当前值为 '{}'",
                    data.kind
                ),
            });
        }
    }

    ValidationResult::with_errors(errors)
}

// ---------------------------------------------------------------------------
// 综合校验入口
// ---------------------------------------------------------------------------

/// 同时执行结构校验和语义校验
pub fn validate_plan(plan: &WorkflowPlanJson, valid_agent_ids: &[String]) -> ValidationResult {
    let mut errors = Vec::new();

    let structural = validate_structure(plan);
    errors.extend(structural.errors);

    // 仅在结构校验通过后做语义校验，避免重复/无意义的错误
    if errors.is_empty() {
        let semantic = validate_semantics(plan, valid_agent_ids);
        errors.extend(semantic.errors);
    }

    ValidationResult::with_errors(errors)
}

// ---------------------------------------------------------------------------
// DAG 环检测 (Kahn's algorithm)
// ---------------------------------------------------------------------------

fn detect_cycle(plan: &WorkflowPlanJson) -> Option<String> {
    let node_ids: HashSet<&str> = plan.nodes.iter().map(|n| n.id.as_str()).collect();

    // 构建邻接表和入度表
    let mut adj: HashMap<&str, Vec<&str>> = HashMap::new();
    let mut in_degree: HashMap<&str, usize> = HashMap::new();

    for id in &node_ids {
        adj.entry(id).or_default();
        in_degree.entry(id).or_insert(0);
    }

    for edge in &plan.edges {
        if node_ids.contains(edge.source.as_str()) && node_ids.contains(edge.target.as_str()) {
            adj.entry(edge.source.as_str())
                .or_default()
                .push(edge.target.as_str());
            *in_degree.entry(edge.target.as_str()).or_insert(0) += 1;
        }
    }

    // Kahn's algorithm
    let mut queue: Vec<&str> = in_degree
        .iter()
        .filter(|entry| *entry.1 == 0)
        .map(|entry| *entry.0)
        .collect();

    let mut visited_count = 0usize;

    while let Some(node) = queue.pop() {
        visited_count += 1;
        if let Some(neighbors) = adj.get(node) {
            for &neighbor in neighbors {
                let deg = in_degree.get_mut(neighbor).unwrap();
                *deg -= 1;
                if *deg == 0 {
                    queue.push(neighbor);
                }
            }
        }
    }

    if visited_count < node_ids.len() {
        Some("工作流图中存在循环依赖，请检查节点间的边关系".into())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use db::models::workflow_types::*;

    use super::*;

    fn make_valid_plan() -> WorkflowPlanJson {
        WorkflowPlanJson {
            version: "1".into(),
            title: "测试计划".into(),
            goal: "测试目标".into(),
            agents: WorkflowPlanAgents {
                lead: "lead-agent".into(),
                available: vec!["agent-1".into(), "agent-2".into()],
            },
            globals: None,
            viewport: None,
            nodes: vec![
                WorkflowPlanNode {
                    id: "task_1".into(),
                    node_type: "workflowStep".into(),
                    position: WorkflowNodePosition { x: 0.0, y: 0.0 },
                    data: WorkflowNodeData {
                        step_type: "task".into(),
                        agent_id: Some("agent-1".into()),
                        title: "任务 1".into(),
                        instructions: "执行任务 1".into(),
                        acceptance: None,
                        outputs: None,
                        interruptible: true,
                        max_retry: None,
                        status: None,
                        loop_key: None,
                        review_scope: None,
                    },
                },
                WorkflowPlanNode {
                    id: "result".into(),
                    node_type: "workflowStep".into(),
                    position: WorkflowNodePosition { x: 0.0, y: 140.0 },
                    data: WorkflowNodeData {
                        step_type: "result".into(),
                        agent_id: None,
                        title: "最终结果".into(),
                        instructions: "汇总结果".into(),
                        acceptance: None,
                        outputs: None,
                        interruptible: true,
                        max_retry: None,
                        status: None,
                        loop_key: None,
                        review_scope: None,
                    },
                },
            ],
            edges: vec![WorkflowPlanEdge {
                id: "task_1->result".into(),
                source: "task_1".into(),
                target: "result".into(),
                edge_type: Some("workflowEdge".into()),
                data: None,
            }],
            loops: None,
            policies: None,
        }
    }

    fn valid_agents() -> Vec<String> {
        vec!["lead-agent".into(), "agent-1".into(), "agent-2".into()]
    }

    #[test]
    fn test_valid_plan_passes() {
        let plan = make_valid_plan();
        let result = validate_plan(&plan, &valid_agents());
        assert!(result.is_valid, "errors: {:?}", result.errors);
    }

    #[test]
    fn test_empty_title_rejected() {
        let mut plan = make_valid_plan();
        plan.title = "".into();
        let result = validate_structure(&plan);
        assert!(!result.is_valid);
        assert!(result.errors.iter().any(|e| e.field == "title"));
    }

    #[test]
    fn test_duplicate_node_id_rejected() {
        let mut plan = make_valid_plan();
        plan.nodes[1].id = "task_1".into(); // duplicate
        let result = validate_structure(&plan);
        assert!(!result.is_valid);
        assert!(result.errors.iter().any(|e| e.message.contains("重复")));
    }

    #[test]
    fn test_invalid_step_type_rejected() {
        let mut plan = make_valid_plan();
        plan.nodes[0].data.step_type = "unknown".into();
        let result = validate_structure(&plan);
        assert!(!result.is_valid);
        assert!(result.errors.iter().any(|e| e.message.contains("步骤类型")));
    }

    #[test]
    fn test_duplicate_edge_id_rejected() {
        let mut plan = make_valid_plan();
        plan.edges.push(WorkflowPlanEdge {
            id: "task_1->result".into(), // duplicate
            source: "task_1".into(),
            target: "result".into(),
            edge_type: None,
            data: None,
        });
        let result = validate_structure(&plan);
        assert!(!result.is_valid);
    }

    #[test]
    fn test_cycle_detection() {
        let mut plan = make_valid_plan();
        // Add a cycle: result -> task_1
        plan.edges.push(WorkflowPlanEdge {
            id: "result->task_1".into(),
            source: "result".into(),
            target: "task_1".into(),
            edge_type: None,
            data: None,
        });
        let result = validate_semantics(&plan, &valid_agents());
        assert!(!result.is_valid);
        assert!(result.errors.iter().any(|e| e.message.contains("循环依赖")));
    }

    #[test]
    fn test_missing_result_node_rejected() {
        let mut plan = make_valid_plan();
        plan.nodes.retain(|n| n.data.step_type != "result");
        plan.edges.clear();
        let result = validate_semantics(&plan, &valid_agents());
        assert!(!result.is_valid);
        assert!(result.errors.iter().any(|e| e.message.contains("result")));
    }

    #[test]
    fn test_multiple_result_nodes_rejected() {
        let mut plan = make_valid_plan();
        plan.nodes.push(WorkflowPlanNode {
            id: "result_2".into(),
            node_type: "workflowStep".into(),
            position: WorkflowNodePosition { x: 0.0, y: 280.0 },
            data: WorkflowNodeData {
                step_type: "result".into(),
                agent_id: None,
                title: "第二个结果".into(),
                instructions: "不应存在".into(),
                acceptance: None,
                outputs: None,
                interruptible: true,
                max_retry: None,
                status: None,
                loop_key: None,
                review_scope: None,
            },
        });
        let result = validate_semantics(&plan, &valid_agents());
        assert!(!result.is_valid);
    }

    #[test]
    fn test_result_node_no_outgoing_edges() {
        let mut plan = make_valid_plan();
        plan.nodes.push(WorkflowPlanNode {
            id: "extra".into(),
            node_type: "workflowStep".into(),
            position: WorkflowNodePosition { x: 0.0, y: 280.0 },
            data: WorkflowNodeData {
                step_type: "task".into(),
                agent_id: Some("agent-1".into()),
                title: "额外任务".into(),
                instructions: "不应被 result 后继".into(),
                acceptance: None,
                outputs: None,
                interruptible: true,
                max_retry: None,
                status: None,
                loop_key: None,
                review_scope: None,
            },
        });
        plan.edges.push(WorkflowPlanEdge {
            id: "result->extra".into(),
            source: "result".into(),
            target: "extra".into(),
            edge_type: None,
            data: None,
        });
        let result = validate_semantics(&plan, &valid_agents());
        assert!(!result.is_valid);
        assert!(result.errors.iter().any(|e| e.message.contains("出边")));
    }

    #[test]
    fn test_invalid_agent_reference_rejected() {
        let mut plan = make_valid_plan();
        plan.nodes[0].data.agent_id = Some("nonexistent-agent".into());
        let result = validate_semantics(&plan, &valid_agents());
        assert!(!result.is_valid);
        assert!(result.errors.iter().any(|e| e.message.contains("团队成员")));
    }

    #[test]
    fn test_invalid_available_agent_rejected() {
        let mut plan = make_valid_plan();
        plan.agents.available.push("ghost-agent".into());
        let result = validate_semantics(&plan, &valid_agents());
        assert!(!result.is_valid);
        assert!(result.errors.iter().any(|e| e.field == "agents.available"));
    }

    #[test]
    fn test_agent_reference_must_exist_in_available_list() {
        let mut plan = make_valid_plan();
        plan.agents.available = vec!["agent-2".into()];
        let result = validate_semantics(&plan, &valid_agents());
        assert!(!result.is_valid);
        assert!(
            result
                .errors
                .iter()
                .any(|e| e.message.contains("agents.available"))
        );
    }

    #[test]
    fn test_invalid_edge_endpoint_rejected() {
        let mut plan = make_valid_plan();
        plan.edges[0].source = "nonexistent".into();
        let result = validate_semantics(&plan, &valid_agents());
        assert!(!result.is_valid);
        assert!(result.errors.iter().any(|e| e.message.contains("不存在")));
    }

    #[test]
    fn test_invalid_lead_rejected() {
        let plan = make_valid_plan();
        let agents = vec!["agent-1".into(), "agent-2".into()]; // lead-agent not included
        let result = validate_semantics(&plan, &agents);
        assert!(!result.is_valid);
        assert!(result.errors.iter().any(|e| e.field == "agents.lead"));
    }
}
