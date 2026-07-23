use serde_json::Value;

const SECRET_KEYS: &[&str] = &[
    "authorization",
    "proxy-authorization",
    "api_key",
    "apikey",
    "access_token",
    "refresh_token",
    "id_token",
    "token",
    "password",
    "cookie",
    "set-cookie",
    "x-api-key",
];

pub fn redact_string(value: &str) -> String {
    let mut output = value.to_string();
    for prefix in [
        "Bearer ",
        "Basic ",
        "token=",
        "api_key=",
        "apikey=",
        "access_token=",
        "password=",
    ] {
        if let Some(index) = output
            .to_ascii_lowercase()
            .find(&prefix.to_ascii_lowercase())
        {
            let value_start = index + prefix.len();
            let end = output[value_start..]
                .find(|character: char| {
                    character.is_whitespace() || character == '&' || character == ';'
                })
                .map(|offset| value_start + offset)
                .unwrap_or(output.len());
            output.replace_range(index..end, "[REDACTED]");
        }
    }
    output
}

pub fn redact_json(value: &Value) -> Value {
    match value {
        Value::Object(object) => Value::Object(
            object
                .iter()
                .map(|(key, value)| {
                    let normalized = key.to_ascii_lowercase().replace('-', "_");
                    let is_secret = SECRET_KEYS
                        .iter()
                        .any(|secret| normalized == secret.replace('-', "_"))
                        || normalized.ends_with("_token")
                        || normalized.ends_with("_secret")
                        || normalized.ends_with("_password");
                    let is_secret = is_secret
                        || normalized.ends_with("_api_key")
                        || normalized.ends_with("_apikey");
                    let redacted = if is_secret {
                        Value::String("[REDACTED]".to_string())
                    } else {
                        redact_json(value)
                    };
                    (key.clone(), redacted)
                })
                .collect(),
        ),
        Value::Array(items) => Value::Array(items.iter().map(redact_json).collect()),
        Value::String(text) => Value::String(redact_string(text)),
        primitive => primitive.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn redacts_nested_headers_and_environment_names() {
        let input = json!({"headers":{"Authorization":"Bearer top-secret"}, "OPENAI_API_KEY":"abc", "safe":"ok"});
        assert_eq!(
            redact_json(&input)["headers"]["Authorization"],
            "[REDACTED]"
        );
        assert_eq!(redact_json(&input)["OPENAI_API_KEY"], "[REDACTED]");
    }

    #[test]
    fn redacts_inline_bearer_token() {
        assert_eq!(
            redact_string("Authorization: Bearer abc.def"),
            "Authorization: [REDACTED]"
        );
    }
}
