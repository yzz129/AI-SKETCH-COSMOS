export function Lighting() {
  return (
    <>
      <hemisphereLight args={['#d6ecff', '#080018', 1.25]} />
      <directionalLight position={[-4, 5, 3]} intensity={1.35} color="#c9e8ff" />
      <pointLight position={[2.8, 1.8, 2.2]} intensity={2.8} color="#8c6dff" distance={8} />
      <pointLight position={[-2.8, -0.2, 1.4]} intensity={1.9} color="#31d7ff" distance={6} />
    </>
  );
}
