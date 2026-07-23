use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct PlanStep {
    pub id: String,
    pub description: String,
    pub completed: bool,
}
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct Plan {
    pub steps: Vec<PlanStep>,
}

pub fn reduce(state: &mut Plan, steps: Vec<PlanStep>) {
    // The newest full plan is authoritative; preserving source order makes rendering deterministic.
    state.steps = steps;
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn replaces_plan_in_source_order() {
        let mut plan = Plan::default();
        reduce(
            &mut plan,
            vec![
                PlanStep {
                    id: "2".into(),
                    description: "second".into(),
                    completed: false,
                },
                PlanStep {
                    id: "1".into(),
                    description: "first".into(),
                    completed: true,
                },
            ],
        );
        assert_eq!(
            plan.steps
                .iter()
                .map(|step| step.id.as_str())
                .collect::<Vec<_>>(),
            ["2", "1"]
        );
    }
    #[test]
    fn empty_plan_clears_stale_steps() {
        let mut plan = Plan {
            steps: vec![PlanStep::default()],
        };
        reduce(&mut plan, vec![]);
        assert!(plan.steps.is_empty());
    }
}
