use fork_core::continuation::{
    Codim1CurvePoint, Codim1CurveType, Codim2BifurcationType, Codim2BranchSwitch,
    Codim2Certification, Codim2Coefficient, Codim2Conditioning, Codim2PointData,
};

fn event(kind: Codim2BifurcationType, test_value: f64) -> Codim2PointData {
    Codim2PointData {
        bifurcation_type: kind,
        refined: true,
        candidate: false,
        test_function: "canonical test".to_string(),
        test_function_value: test_value,
        residual_norm: 1e-12,
        iterations: 3,
        tolerance: 1e-9,
        source_segment: [0, 1],
        source_test_values: [-0.1, 0.1],
        method: "curve-corrected secant".to_string(),
        coefficients: vec![Codim2Coefficient {
            name: "test".to_string(),
            value: test_value,
        }],
        conditioning: Codim2Conditioning::default(),
        branch_switches: vec![Codim2BranchSwitch {
            target: Codim1CurveType::NeimarkSacker,
            available: true,
            target_auxiliary: Some(0.25),
            reason: None,
        }],
        certification: Codim2Certification {
            defining_conditions_verified: true,
            nondegeneracy_evaluated: false,
            nondegenerate: None,
            reason: Some("metadata-only parity coefficient".to_string()),
        },
    }
}

#[test]
fn legacy_curve_points_default_new_codim2_metadata_fields() {
    let legacy = r#"{
        "state":[0.0],
        "param1_value":0.0,
        "param2_value":0.0,
        "codim2_type":"CuspOfCycles",
        "auxiliary":null,
        "eigenvalues":[],
        "codim2":{
            "type":"CuspOfCycles",
            "refined":true,
            "candidate":false,
            "test_function":"quadratic coefficient",
            "test_function_value":0.0,
            "residual_norm":0.0,
            "iterations":1,
            "tolerance":1e-8,
            "source_segment":[0,1],
            "source_test_values":[-1.0,1.0],
            "method":"legacy",
            "coefficients":[],
            "conditioning":{}
        }
    }"#;
    let point: Codim1CurvePoint = serde_json::from_str(legacy).expect("legacy point");
    assert!(point.codim2_events.is_empty());
    let metadata = point.codim2.expect("legacy primary event");
    assert!(metadata.branch_switches.is_empty());
    assert_eq!(metadata.certification, Codim2Certification::default());
}

#[test]
fn simultaneous_events_round_trip_in_deterministic_order() {
    let first = event(Codim2BifurcationType::FoldNeimarkSacker, 2e-12);
    let second = event(Codim2BifurcationType::Chenciner, -3e-12);
    let point = Codim1CurvePoint {
        state: vec![0.0],
        param1_value: 0.0,
        param2_value: 0.0,
        codim2_type: first.bifurcation_type,
        auxiliary: Some(0.4),
        eigenvalues: Vec::new(),
        codim2: Some(first.clone()),
        codim2_events: vec![first, second],
    };
    let json = serde_json::to_string(&point).expect("serialize simultaneous events");
    let decoded: Codim1CurvePoint =
        serde_json::from_str(&json).expect("decode simultaneous events");
    assert_eq!(decoded.codim2_events.len(), 2);
    assert_eq!(
        decoded.codim2_events[0].bifurcation_type,
        Codim2BifurcationType::FoldNeimarkSacker
    );
    assert_eq!(
        decoded.codim2_events[1].bifurcation_type,
        Codim2BifurcationType::Chenciner
    );
    assert_eq!(
        decoded.codim2_events[0].branch_switches[0].target_auxiliary,
        Some(0.25)
    );
}
