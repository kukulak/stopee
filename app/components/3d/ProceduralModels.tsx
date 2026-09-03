import { useMemo, type RefObject } from "react";
import * as THREE from "three";
import { MeshTransmissionMaterial } from "@react-three/drei";

/**
 * Todos los objetos de esta escena son geometría procedural (Lathe/Cylinder/
 * Torus) generada en código — no hay archivos .glb/.gltf. Cada componente
 * expone sus partes móviles vía refs pasados desde el orquestador
 * (ScrollytellingSection), que las anima directamente con GSAP. Cuando haya
 * modelos reales, cada componente puede sustituirse internamente por
 * `useGLTF(...)` sin tocar la coreografía de scroll.
 */

const BRAND = {
  lima: "#B5D334",
  oliva: "#7A9330",
  bosque: "#3E531D",
  carbon: "#181C14",
  carbonDeep: "#11130E",
  hueso: "#FDFBF7",
};

function useLabelTexture() {
  return useMemo(() => {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.fillStyle = BRAND.carbon;
    ctx.fillRect(0, 0, 512, 512);

    ctx.strokeStyle = BRAND.bosque;
    ctx.lineWidth = 46;
    ctx.beginPath();
    ctx.arc(180, 160, 130, 0.2, Math.PI * 1.6);
    ctx.stroke();

    ctx.strokeStyle = BRAND.oliva;
    ctx.lineWidth = 30;
    ctx.beginPath();
    ctx.arc(340, 360, 110, 0.6, Math.PI * 1.9);
    ctx.stroke();

    ctx.fillStyle = BRAND.carbonDeep;
    ctx.beginPath();
    ctx.ellipse(256, 256, 210, 96, -0.06, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = BRAND.lima;
    ctx.font = "900 108px Outfit, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.save();
    ctx.translate(256, 264);
    ctx.rotate(-0.06);
    ctx.fillText("STOPee", 0, 0);
    ctx.restore();

    ctx.fillStyle = BRAND.oliva;
    ctx.font = "700 18px 'Plus Jakarta Sans', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("CONCENTRADO BIOTECNOLÓGICO DE HIGIENE URBANA", 256, 340);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }, []);
}

// Perfil de la botella 1L: base ancha, hombro curvo, cuello angosto.
const bottleProfile = [
  new THREE.Vector2(0, 0),
  new THREE.Vector2(0.58, 0),
  new THREE.Vector2(0.58, 1.55),
  new THREE.Vector2(0.5, 1.95),
  new THREE.Vector2(0.28, 2.25),
  new THREE.Vector2(0.21, 2.28),
  new THREE.Vector2(0.21, 2.52),
  new THREE.Vector2(0, 2.52),
];

export function Bottle1L({
  groupRef,
  position,
  rotation,
}: {
  groupRef: RefObject<THREE.Group>;
  position?: [number, number, number];
  rotation?: [number, number, number];
}) {
  const label = useLabelTexture();
  const bodyGeometry = useMemo(() => new THREE.LatheGeometry(bottleProfile, 48), []);

  return (
    <group ref={groupRef} position={position} rotation={rotation}>
      <mesh geometry={bodyGeometry} castShadow receiveShadow>
        <meshPhysicalMaterial color={BRAND.hueso} roughness={0.28} clearcoat={0.5} clearcoatRoughness={0.3} />
      </mesh>
      <mesh position={[0, 1.15, 0]}>
        <cylinderGeometry args={[0.585, 0.585, 1.25, 48, 1, true]} />
        <meshStandardMaterial
          map={label ?? undefined}
          color={label ? undefined : BRAND.carbon}
          roughness={0.55}
          side={THREE.DoubleSide}
          transparent
        />
      </mesh>
    </group>
  );
}

export function Cap({
  groupRef,
  liquidRef,
  position,
  rotation,
}: {
  groupRef: RefObject<THREE.Group>;
  liquidRef: RefObject<THREE.Mesh>;
  position?: [number, number, number];
  rotation?: [number, number, number];
}) {
  const ridgeCount = 7;

  return (
    <group ref={groupRef} position={position} rotation={rotation}>
      <mesh castShadow>
        <cylinderGeometry args={[0.25, 0.27, 0.34, 24]} />
        <meshStandardMaterial color={BRAND.hueso} roughness={0.4} />
      </mesh>
      {Array.from({ length: ridgeCount }).map((_, i) => (
        <mesh
          key={i}
          position={[0, -0.15 + (i / (ridgeCount - 1)) * 0.3, 0]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <torusGeometry args={[0.26, 0.011, 8, 32]} />
          <meshStandardMaterial color="#E8E6DF" roughness={0.5} />
        </mesh>
      ))}
      <mesh ref={liquidRef} position={[0, -0.1, 0]} scale={[1, 0, 1]}>
        <cylinderGeometry args={[0.2, 0.2, 0.24, 24]} />
        <meshStandardMaterial color={BRAND.lima} roughness={0.15} transparent opacity={0.92} />
      </mesh>
    </group>
  );
}

// Perfil de la botella squishable: cuerpo capsular achatado, cuello corto.
const squishableProfile = [
  new THREE.Vector2(0, 0),
  new THREE.Vector2(0.42, 0),
  new THREE.Vector2(0.46, 0.25),
  new THREE.Vector2(0.46, 1.15),
  new THREE.Vector2(0.4, 1.4),
  new THREE.Vector2(0.18, 1.55),
  new THREE.Vector2(0.15, 1.55),
  new THREE.Vector2(0.15, 1.72),
  new THREE.Vector2(0, 1.72),
];

export function SquishableBottle({
  groupRef,
  liquidRef,
  position,
  rotation,
}: {
  groupRef: RefObject<THREE.Group>;
  liquidRef: RefObject<THREE.Mesh>;
  position?: [number, number, number];
  rotation?: [number, number, number];
}) {
  const label = useLabelTexture();
  const bodyGeometry = useMemo(() => new THREE.LatheGeometry(squishableProfile, 40), []);

  return (
    <group ref={groupRef} position={position} rotation={rotation}>
      <mesh geometry={bodyGeometry}>
        <MeshTransmissionMaterial
          color={BRAND.hueso}
          roughness={0.18}
          thickness={0.5}
          transmission={0.94}
          ior={1.3}
          chromaticAberration={0.02}
          anisotropy={0.1}
          distortion={0.15}
          distortionScale={0.2}
          temporalDistortion={0.05}
          backside
        />
      </mesh>
      <mesh ref={liquidRef} position={[0, 0.05, 0]} scale={[0.82, 0.001, 0.82]}>
        <cylinderGeometry args={[0.42, 0.42, 1.1, 32]} />
        <meshPhysicalMaterial
          color="#BFE0EE"
          roughness={0.1}
          transmission={0.4}
          transparent
          opacity={0.85}
        />
      </mesh>
      <mesh position={[0, 0.78, 0.47]} rotation={[0, 0, 0]}>
        <planeGeometry args={[0.62, 0.32]} />
        <meshStandardMaterial
          map={label ?? undefined}
          color={label ? undefined : BRAND.carbon}
          transparent
          roughness={0.6}
        />
      </mesh>
    </group>
  );
}

export function Faucet({
  groupRef,
  position,
  rotation,
}: {
  groupRef: RefObject<THREE.Group>;
  position?: [number, number, number];
  rotation?: [number, number, number];
}) {
  const chrome = { color: "#D7DBDF", metalness: 1, roughness: 0.12 } as const;

  return (
    <group ref={groupRef} position={position} rotation={rotation}>
      {/* riser */}
      <mesh position={[0, 0.6, 0]} castShadow>
        <cylinderGeometry args={[0.11, 0.11, 1.2, 24]} />
        <meshStandardMaterial {...chrome} />
      </mesh>
      {/* codo */}
      <mesh position={[0.32, 1.22, 0]} rotation={[0, 0, 0]}>
        <torusGeometry args={[0.32, 0.11, 16, 32, Math.PI]} />
        <meshStandardMaterial {...chrome} />
      </mesh>
      {/* pico */}
      <mesh position={[0.64, 1.22, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.1, 0.09, 0.5, 20]} />
        <meshStandardMaterial {...chrome} />
      </mesh>
      {/* base */}
      <mesh position={[0, 0.02, 0]}>
        <cylinderGeometry args={[0.2, 0.24, 0.08, 24]} />
        <meshStandardMaterial {...chrome} />
      </mesh>
    </group>
  );
}

export function WaterStream({
  meshRef,
  position,
}: {
  meshRef: RefObject<THREE.Mesh>;
  position?: [number, number, number];
}) {
  return (
    <mesh ref={meshRef} position={position} scale={[1, 0, 1]}>
      <cylinderGeometry args={[0.035, 0.045, 1, 12]} />
      <meshPhysicalMaterial
        color="#DCEFF7"
        roughness={0.05}
        transmission={0.9}
        transparent
        opacity={0.85}
      />
    </mesh>
  );
}
