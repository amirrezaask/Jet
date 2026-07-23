use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct Usage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub total_tokens: u64,
}

pub fn reduce(state: &mut Usage, update: Usage) {
    state.input_tokens = state.input_tokens.max(update.input_tokens);
    state.output_tokens = state.output_tokens.max(update.output_tokens);
    state.total_tokens = state
        .total_tokens
        .max(update.total_tokens)
        .max(state.input_tokens + state.output_tokens);
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn usage_never_regresses_for_out_of_order_updates() {
        let mut usage = Usage::default();
        reduce(
            &mut usage,
            Usage {
                input_tokens: 10,
                output_tokens: 5,
                total_tokens: 15,
            },
        );
        reduce(
            &mut usage,
            Usage {
                input_tokens: 9,
                output_tokens: 3,
                total_tokens: 12,
            },
        );
        assert_eq!(
            usage,
            Usage {
                input_tokens: 10,
                output_tokens: 5,
                total_tokens: 15
            }
        );
    }
    #[test]
    fn total_is_at_least_component_sum() {
        let mut usage = Usage::default();
        reduce(
            &mut usage,
            Usage {
                input_tokens: 4,
                output_tokens: 9,
                total_tokens: 1,
            },
        );
        assert_eq!(usage.total_tokens, 13);
    }
}
