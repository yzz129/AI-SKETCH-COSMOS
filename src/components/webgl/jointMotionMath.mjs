export function integrateDampedAngle(
  state,
  targetAngle,
  deltaTime,
  inertia,
  stiffness,
  dampingRatio,
  maxAngularSpeed,
  maxAngularAcceleration,
  maxAngle
) {
  if (
    !Number.isFinite(targetAngle)
    || !Number.isFinite(deltaTime)
    || deltaTime <= 0
    || !Number.isFinite(inertia)
    || inertia <= 0
    || !Number.isFinite(stiffness)
    || stiffness <= 0
  ) {
    return state;
  }

  const damping = 2 * dampingRatio * Math.sqrt(stiffness * inertia);
  const integrationSteps = Math.max(1, Math.ceil(deltaTime / (1 / 45)));
  const step = deltaTime / integrationSteps;
  for (let iteration = 0; iteration < integrationSteps; iteration += 1) {
    const torque = stiffness * (targetAngle - state.angle)
      - damping * state.angularVelocity;
    const acceleration = Math.max(
      -maxAngularAcceleration,
      Math.min(maxAngularAcceleration, torque / inertia)
    );
    state.angularVelocity = Math.max(
      -maxAngularSpeed,
      Math.min(maxAngularSpeed, state.angularVelocity + acceleration * step)
    );
    state.angle = Math.max(
      -maxAngle,
      Math.min(maxAngle, state.angle + state.angularVelocity * step)
    );
  }
  return state;
}
