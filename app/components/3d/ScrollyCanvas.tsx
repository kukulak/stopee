import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { RefObject } from "react";
import { useEffect, useRef } from "react";
import * as THREE from "three";
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

/**
 * R3F no apunta la cámara al origen por defecto: solo fija `position`, la
 * rotación queda en identidad (mirando hacia -Z). Sin este rig la escena
 * se recorta por arriba porque la cámara nunca mira hacia donde está el
 * producto. Se fuerza el lookAt cada frame (costo despreciable).
 *
 * Además, un FOV vertical fijo no garantiza que el ancho de escena quepa en
 * pantallas angostas (móvil): en retrato el FOV horizontal efectivo se
 * reduce y la botella (en x≈1.4) queda fuera de cuadro. Por eso la distancia
 * de la cámara se recalcula en cada resize para que TANTO el ancho como el
 * alto necesarios entren en el frustum (equivalente a `object-fit: contain`).
 */
function CameraRig({
  target,
  halfWidth,
  halfHeight,
  narrowHalfWidth,
}: {
  target: [number, number, number];
  halfWidth: number;
  halfHeight: number;
  /** Semiancho requerido en <640px, donde ScrollytellingSection también acerca los objetos al centro. */
  narrowHalfWidth: number;
}) {
  const { camera, size } = useThree();
  const targetVec = useRef(new THREE.Vector3(...target));

  useEffect(() => {
    const persp = camera as THREE.PerspectiveCamera;
    const aspect = size.width / size.height;
    const vFovRad = (persp.fov * Math.PI) / 180;
    const effectiveHalfWidth = size.width < 640 ? narrowHalfWidth : halfWidth;
    const distanceForHeight = halfHeight / Math.tan(vFovRad / 2);
    const distanceForWidth = effectiveHalfWidth / (Math.tan(vFovRad / 2) * aspect);
    persp.position.z = Math.max(distanceForHeight, distanceForWidth, 4);
    persp.updateProjectionMatrix();
  }, [camera, size.width, size.height, halfWidth, halfHeight, narrowHalfWidth]);

  useFrame(() => {
    camera.lookAt(targetVec.current);
  });
  return null;
}

export function ScrollyCanvas({ refs, onReady }: { refs: SceneRefs; onReady?: () => void }) {
  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      camera={{ position: [0, 0.35, 5.8], fov: 32 }}
      gl={{
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
        preserveDrawingBuffer: true,
      }}
      style={{ background: "transparent" }}
      onCreated={() => onReady?.()}
    >
      <CameraRig target={[0, 0, 0]} halfWidth={2.5} halfHeight={1.85} narrowHalfWidth={1.7} />

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

      {/* Escenario recentrado: sin este offset el bote (alto ~2.5u, base en
          y=0.2) quedaba con su mitad superior fuera del frustum. */}
      <group position={[0, -1.3, 0]}>
        <Bottle1L groupRef={refs.bottleRef} position={[1.4, 0.2, 0]} />
        <Cap groupRef={refs.capRef} liquidRef={refs.capLiquidRef} position={[1.4, 1.9, 0]} />
        <SquishableBottle
          groupRef={refs.squishableRef}
          liquidRef={refs.squishableLiquidRef}
          position={[0, -4, 0]}
        />
        <Faucet groupRef={refs.faucetRef} position={[-4.5, 1.6, 0]} />
        <WaterStream meshRef={refs.waterStreamRef} position={[-1.7, 1.1, 0]} />
      </group>
    </Canvas>
  );
}
