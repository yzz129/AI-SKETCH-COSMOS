function clamp01(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function smooth01(value) {
  const progress = clamp01(value);
  return progress * progress * (3 - 2 * progress);
}

function pulse(progress, center, width) {
  const distance = (progress - center) / width;
  return Math.exp(-distance * distance);
}

export function createCreaturePartAction() {
  return {
    kind: 'idle',
    phase: 0,
    punch: 0,
    punchSide: 0,
    kick: 0,
    kickSide: 0,
    bite: 0,
    hit: 0,
    guard: 0,
    windup: 0,
    curl: 0,
    struggle: 0,
    compression: 0,
    targetSide: 0
  };
}

export function resetCreaturePartAction(target) {
  target.kind = 'idle';
  target.phase = 0;
  target.punch = 0;
  target.punchSide = 0;
  target.kick = 0;
  target.kickSide = 0;
  target.bite = 0;
  target.hit = 0;
  target.guard = 0;
  target.windup = 0;
  target.curl = 0;
  target.struggle = 0;
  target.compression = 0;
  target.targetSide = 0;
  return target;
}

export function writeFightCreaturePartAction(target, rawProgress, role) {
  const progress = clamp01(rawProgress);
  const targetSide = role === 'left' ? 1 : -1;
  const firstPunchCenter = role === 'left' ? 0.2 : 0.34;
  const secondPunchCenter = role === 'left' ? 0.69 : 0.79;
  const biteCenter = role === 'left' ? 0.5 : 0.61;
  const kickCenter = role === 'left' ? 0.84 : 0.44;
  const receivedPunchA = role === 'left' ? 0.34 : 0.2;
  const receivedPunchB = role === 'left' ? 0.79 : 0.69;
  const receivedBite = role === 'left' ? 0.61 : 0.5;
  const receivedKick = role === 'left' ? 0.44 : 0.84;
  const firstPunch = pulse(progress, firstPunchCenter, 0.052);
  const secondPunch = pulse(progress, secondPunchCenter, 0.058);
  const kick = pulse(progress, kickCenter, 0.068);
  const incoming = Math.max(
    pulse(progress, receivedPunchA, 0.06),
    pulse(progress, receivedPunchB, 0.065),
    pulse(progress, receivedBite, 0.08) * 0.82,
    pulse(progress, receivedKick, 0.075) * 0.88
  );
  const guard = Math.max(
    pulse(progress, receivedPunchA - 0.045, 0.075),
    pulse(progress, receivedPunchB - 0.045, 0.08),
    pulse(progress, receivedBite - 0.055, 0.09),
    pulse(progress, receivedKick - 0.05, 0.085)
  ) * 0.72;

  target.kind = 'fight';
  target.phase = progress * Math.PI * 6;
  target.punch = Math.max(firstPunch, secondPunch);
  target.punchSide = firstPunch >= secondPunch ? targetSide : -targetSide;
  target.kick = kick;
  target.kickSide = -targetSide;
  target.bite = pulse(progress, biteCenter, 0.072);
  target.guard = guard;
  target.windup = Math.max(
    pulse(progress, firstPunchCenter - 0.075, 0.058),
    pulse(progress, secondPunchCenter - 0.08, 0.065),
    pulse(progress, biteCenter - 0.09, 0.075),
    pulse(progress, kickCenter - 0.085, 0.07)
  );
  target.hit = incoming * (1 - guard * 0.38);
  target.curl = Math.max(target.hit * 0.72, guard * 0.28);
  target.struggle = smooth01(progress / 0.12)
    * (1 - smooth01((progress - 0.9) / 0.1));
  target.compression = 0;
  target.targetSide = targetSide;
  return target;
}

export function writeTrappedCreaturePartAction(
  target,
  rawAge,
  rawCaptureDuration,
  rawDuration
) {
  const age = Math.max(0, Number.isFinite(rawAge) ? rawAge : 0);
  const captureDuration = Math.max(0.1, Number.isFinite(rawCaptureDuration) ? rawCaptureDuration : 2.1);
  const duration = Math.max(captureDuration + 0.2, Number.isFinite(rawDuration) ? rawDuration : captureDuration + 3.4);
  const capture = smooth01(age / captureDuration);
  const struggleAge = Math.max(0, age - captureDuration);
  const struggleIn = smooth01(struggleAge / 0.34);
  const struggleOut = 1 - smooth01((age - (duration - 0.52)) / 0.52);
  const suctionResistance = Math.sin(Math.PI * clamp01(age / captureDuration)) * 0.55;

  target.kind = 'trapped';
  target.phase = age * 7.2;
  target.punch = 0;
  target.punchSide = 0;
  target.kick = 0;
  target.kickSide = 0;
  target.bite = 0;
  target.hit = 0;
  target.guard = capture * 0.24;
  target.windup = 0;
  target.curl = capture * (0.36 + Math.sin(age * 3.4) * 0.08)
    + struggleIn * struggleOut * (0.1 + Math.sin(age * 5.1) * 0.06);
  target.struggle = Math.max(suctionResistance, struggleIn * struggleOut);
  target.compression = capture;
  target.targetSide = 0;
  return target;
}

export function writeVictoryCreaturePartAction(target, rawProgress) {
  const progress = clamp01(rawProgress);
  target.kind = 'victory';
  target.phase = progress * Math.PI * 5;
  target.punch = 0;
  target.punchSide = 0;
  target.kick = Math.pow(Math.sin(progress * Math.PI * 2), 2) * 0.34;
  target.kickSide = progress < 0.5 ? -1 : 1;
  target.bite = 0;
  target.hit = 0;
  target.guard = 0;
  target.windup = 0;
  target.curl = 0;
  target.struggle = Math.sin(progress * Math.PI);
  target.compression = 0;
  target.targetSide = 0;
  return target;
}

export function writeImpactCreaturePartAction(target, rawProgress) {
  const progress = clamp01(rawProgress);
  target.kind = 'impact';
  target.phase = progress * Math.PI * 4;
  target.punch = 0;
  target.punchSide = 0;
  target.kick = 0;
  target.kickSide = 0;
  target.bite = 0;
  target.hit = Math.sin(progress * Math.PI);
  target.guard = 0;
  target.windup = 0;
  target.curl = target.hit * 0.68;
  target.struggle = 0;
  target.compression = Math.sin(progress * Math.PI) * 0.35;
  target.targetSide = 0;
  return target;
}
