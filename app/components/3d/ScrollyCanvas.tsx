import { Canvas } from "@react-three/fiber";
import type { RefObject } from "react";
import type * as THREE from "three";
import { Bottle1L, Cap, SquishableBottle, Faucet, WaterStream } from "./ProceduralModels";

export type SceneRefs = {
  bottleRef: RefObject<THREE.Group>;
  capRef: RefObject<THREE.Group>;
  capLiquidRef: RefObject<THREE.Mesh>;
  squishableRef: RefObject<THREE.Group>;
  squishableLiquidRef: RefObject<THREE.Mesh>;
  faucetRef: RefObject<THREE.Group>;
  waterStreamRef: RefObject<THREE.Mesh>;
};

export function ScrollyCanvas({ refs, onReady }: { refs: SceneRefs; onReady?: () => void }) {
  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      camera={{ position: [0, 0.9, 6.2], fov: 32 }}
      gl={{
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
        preserveDrawingBuffer: true,
      }}
      style={{ background: "transparent" }}
      onCreated={() => onReady?.()}
    >
      <ambientLight intensity={0.6} />
      <directionalLight
        position={[3, 5, 4]}
        intensity={1.5}
        castShadow
        shadow-mapSize={[1024, 1024]}
      />
      <directionalLight position={[-4, 2, -3]} intensity={0.5} color="#B5D334" />
      <pointLight position={[0, -1.5, 3]} intensity={0.4} color="#7A9330" />
      <pointLight position={[-2, 3, 2]} intensity={0.3} color="#FDFBF7" />

      <Bottle1L groupRef={refs.bottleRef} position={[1.4, 0.2, 0]} />
      <Cap groupRef={refs.capRef} liquidRef={refs.capLiquidRef} position={[1.4, 1.9, 0]} />
      <SquishableBottle
        groupRef={refs.squishableRef}
        liquidRef={refs.squishableLiquidRef}
        position={[0, -4, 0]}
      />
      <Faucet groupRef={refs.faucetRef} position={[-4.5, 1.6, 0]} />
      <WaterStream meshRef={refs.waterStreamRef} position={[-1.7, 1.1, 0]} />
    </Canvas>
  );
}
