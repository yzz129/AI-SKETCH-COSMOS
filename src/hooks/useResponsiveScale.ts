import { useThree } from '@react-three/fiber';

/**
 * Returns scale factors so nebula cluster positions adapt to the viewport aspect ratio.
 * Base reference is ~16:9 (1.78). Wider screens get more horizontal spread.
 */
export function useResponsiveScale() {
  const { width, height } = useThree((s) => s.size);
  const aspect = width / Math.max(height, 1);

  // Scale X positions: wider screens push clusters further apart horizontally
  const xScale = Math.max(0.75, Math.min(1.4, aspect / 1.78));
  // Scale Y positions: taller screens get more vertical spread
  const yScale = Math.max(0.8, Math.min(1.3, 1.78 / aspect));

  return { xScale, yScale, aspect };
}
