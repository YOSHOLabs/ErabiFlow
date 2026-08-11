fn keyframe_value_bounds(property: &str) -> (f64, f64) {
    match property {
        "positionX" | "positionY" => (-1.0, 1.0),
        "scale" => (0.1, 3.0),
        "rotation" => (-180.0, 180.0),
        "opacity" => (0.0, 1.0),
        "volume" => (0.0, 2.0),
        _ => (-1_000_000.0, 1_000_000.0),
    }
}

pub(super) fn keyframe_expression(
    keyframes: &[crate::ClipKeyframe],
    property: &str,
    base_value: f64,
    time_variable: &str,
) -> String {
    let (minimum, maximum) = keyframe_value_bounds(property);
    let safe_base = if base_value.is_finite() {
        base_value.clamp(minimum, maximum)
    } else {
        minimum
    };
    let mut points: Vec<&crate::ClipKeyframe> = keyframes
        .iter()
        .filter(|keyframe| {
            keyframe.property == property && keyframe.time.is_finite() && keyframe.value.is_finite()
        })
        .collect();
    points.sort_by(|a, b| a.time.total_cmp(&b.time));
    if points.is_empty() {
        return format!("{safe_base:.6}");
    }
    let mut timeline = vec![(0.0, safe_base, "linear")];
    for point in points {
        let value = point.value.clamp(minimum, maximum);
        if point.time <= 0.000_001 {
            timeline[0] = (0.0, value, point.interpolation.as_str());
        } else {
            timeline.push((point.time, value, point.interpolation.as_str()));
        }
    }
    let mut expression = format!("{:.6}", timeline.last().unwrap().1);
    for index in (1..timeline.len()).rev() {
        let (previous_time, previous_value, _) = timeline[index - 1];
        let (next_time, next_value, interpolation) = timeline[index];
        let segment = if interpolation == "hold" {
            format!("{previous_value:.6}")
        } else {
            format!(
                "{previous_value:.6}+({next_value:.6}-{previous_value:.6})*({time_variable}-{previous_time:.6})/{:.6}",
                (next_time - previous_time).max(0.000_001)
            )
        };
        expression = format!("if(lt({time_variable},{next_time:.6}),{segment},{expression})");
    }
    expression
}

pub(super) fn transition_progress_expression(
    transition: &Option<crate::ClipTransition>,
    time_variable: &str,
    clip_duration: f64,
    incoming: bool,
) -> Option<(String, String)> {
    let transition = transition.as_ref()?;
    if transition.r#type == "none" {
        return None;
    }
    let duration = transition.duration.clamp(0.05, clip_duration.max(0.05));
    let raw = if incoming {
        format!("clip(({time_variable})/{duration:.6},0,1)")
    } else {
        format!("clip(({clip_duration:.6}-({time_variable}))/{duration:.6},0,1)")
    };
    let progress = if transition.r#type == "dissolve" {
        format!("({raw})*({raw})*(3-2*({raw}))")
    } else {
        raw
    };
    Some((transition.r#type.clone(), progress))
}

pub(super) fn apply_transition_expressions(
    opacity: String,
    position_x: String,
    transition_in: &Option<crate::ClipTransition>,
    transition_out: &Option<crate::ClipTransition>,
    time_variable: &str,
    clip_duration: f64,
) -> (String, String) {
    let mut opacity_expression = opacity;
    let mut position_expression = position_x;
    for (incoming, transition) in [(true, transition_in), (false, transition_out)] {
        let Some((kind, progress)) =
            transition_progress_expression(transition, time_variable, clip_duration, incoming)
        else {
            continue;
        };
        if kind == "fade" || kind == "dissolve" {
            opacity_expression = format!("({opacity_expression})*({progress})");
        } else if kind == "slide" {
            let direction = if incoming { -2.0 } else { 2.0 };
            position_expression =
                format!("({position_expression})+({direction:.1})*(1-({progress}))");
        }
    }
    (opacity_expression, position_expression)
}

pub(super) fn apply_zoom_transition_expression(
    base: String,
    transition_in: &Option<crate::ClipTransition>,
    transition_out: &Option<crate::ClipTransition>,
    time_variable: &str,
    clip_duration: f64,
) -> String {
    let mut expression = base;
    for (incoming, transition) in [(true, transition_in), (false, transition_out)] {
        let Some((kind, progress)) =
            transition_progress_expression(transition, time_variable, clip_duration, incoming)
        else {
            continue;
        };
        if kind == "zoom" {
            let factor = if incoming {
                format!("1.28-0.28*({progress})")
            } else {
                format!("1+0.28*(1-({progress}))")
            };
            expression = format!("({expression})*({factor})");
        }
    }
    expression
}

pub(super) fn apply_rotation_transition_expression(
    base: String,
    transition_in: &Option<crate::ClipTransition>,
    transition_out: &Option<crate::ClipTransition>,
    time_variable: &str,
    clip_duration: f64,
) -> String {
    let mut expression = base;
    for (incoming, transition) in [(true, transition_in), (false, transition_out)] {
        let Some((kind, progress)) =
            transition_progress_expression(transition, time_variable, clip_duration, incoming)
        else {
            continue;
        };
        if kind == "rotate" {
            let direction = if incoming { -18.0 } else { 18.0 };
            expression = format!("({expression})+({direction:.1})*(1-({progress}))");
        }
    }
    expression
}

pub(super) fn apply_motion_scale_expression(
    base: String,
    preset: &Option<String>,
    time: &str,
) -> String {
    if preset.as_deref() == Some("pop") {
        format!("({base})*(1+exp(-3.2*({time}))*(0.22+0.12*abs(sin(5*PI*({time})))))")
    } else {
        base
    }
}

pub(super) fn apply_motion_y_expression(
    base: String,
    preset: &Option<String>,
    time: &str,
) -> String {
    if preset.as_deref() == Some("bounce") {
        format!("({base})-0.14*abs(sin(2.5*PI*({time})))")
    } else {
        base
    }
}

pub(super) fn apply_motion_rotation_expression(
    base: String,
    preset: &Option<String>,
    time: &str,
) -> String {
    if preset.as_deref() == Some("swing") {
        format!("({base})+8*sin(3.2*PI*({time}))")
    } else {
        base
    }
}

#[cfg(test)]
mod tests {
    use super::keyframe_expression;

    #[test]
    fn keyframe_expression_sorts_points_and_clamps_values() {
        let points = vec![
            crate::ClipKeyframe {
                id: "late".into(),
                property: "opacity".into(),
                time: 2.0,
                value: 2.0,
                interpolation: "linear".into(),
            },
            crate::ClipKeyframe {
                id: "hold".into(),
                property: "opacity".into(),
                time: 1.0,
                value: 0.5,
                interpolation: "hold".into(),
            },
        ];

        let expression = keyframe_expression(&points, "opacity", 0.0, "t");
        assert!(expression.contains("if(lt(t,1.000000)"));
        assert!(expression.ends_with("1.000000))"));
    }
}
