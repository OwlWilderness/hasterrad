// No payloads, exception text, or persistent records enter this channel.
const stages=new Set(['flow_lookup','flow_expiry','flow_family','flow_binding','flow_phase','callback_shape','token_shape','jwt_temporal','jwt_crypto_or_claims','jwt_missing_nonce','jwt_invalid','jwt_jws_invalid','jwt_jwk_invalid','jwt_jwks_invalid','jwt_no_matching_key','jwt_multiple_matching_keys','jwt_bad_signature','jwt_algorithm_not_allowed','jwt_not_supported','jwt_missing_iss','jwt_missing_sub','jwt_missing_aud','jwt_missing_exp','jwt_missing_iat','jwt_invalid_iat','jwt_invalid_exp','jwt_invalid_nbf','jwt_issuer_mismatch','jwt_audience_mismatch','nonce_subject','audience_party','finish_guard']);
const checked=new WeakMap();
export function markDiagnostic(error,stage){if(stages.has(stage))checked.set(error,stage);return error;}
export function diagnosticFields(error,enabled){const stage=checked.get(error);return enabled===true&&stages.has(stage)?{diagnostic_stage:stage}:{};}
