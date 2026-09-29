import { useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";

type GlobePoint = {
  lat: number;
  lng: number;
  size: number;
  label: string;
  status: "healthy" | "healing";
};

const points: GlobePoint[] = [
  { lat: 40.71, lng: -74, size: 0.34, label: "US East · healthy", status: "healthy" },
  { lat: 37.77, lng: -122.41, size: 0.3, label: "US West · healthy", status: "healthy" },
  { lat: 51.5, lng: -0.12, size: 0.28, label: "London · healthy", status: "healthy" },
  { lat: 52.52, lng: 13.4, size: 0.26, label: "Frankfurt · healing", status: "healing" },
  { lat: 19.07, lng: 72.87, size: 0.32, label: "Mumbai · healthy", status: "healthy" },
  { lat: 1.35, lng: 103.81, size: 0.3, label: "Singapore · healthy", status: "healthy" },
  { lat: 35.67, lng: 139.65, size: 0.27, label: "Tokyo · healthy", status: "healthy" },
  { lat: -33.86, lng: 151.2, size: 0.26, label: "Sydney · healthy", status: "healthy" },
  { lat: -23.55, lng: -46.63, size: 0.24, label: "São Paulo · healthy", status: "healthy" },
];

const arcs = [
  { startLat: 40.71, startLng: -74, endLat: 51.5, endLng: -0.12, order: 1 },
  { startLat: 51.5, startLng: -0.12, endLat: 19.07, endLng: 72.87, order: 2 },
  { startLat: 19.07, startLng: 72.87, endLat: 1.35, endLng: 103.81, order: 3 },
  { startLat: 1.35, startLng: 103.81, endLat: 35.67, endLng: 139.65, order: 4 },
  { startLat: 35.67, startLng: 139.65, endLat: 37.77, endLng: -122.41, order: 5 },
  { startLat: -33.86, startLng: 151.2, endLat: -23.55, endLng: -46.63, order: 6 },
  { startLat: 52.52, startLng: 13.4, endLat: 19.07, endLng: 72.87, order: 7 },
  { startLat: 40.71, startLng: -74, endLat: -23.55, endLng: -46.63, order: 8 },
  { startLat: 37.77, startLng: -122.41, endLat: 1.35, endLng: 103.81, order: 9 },
  { startLat: 52.52, startLng: 13.4, endLat: 35.67, endLng: 139.65, order: 10 },
];

export default function NetworkGlobe() {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 640, height: 520 });
  const rings = useMemo(() => points, []);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, []);

  const startRotation = () => {
    const globe = globeRef.current;
    const controls = globe?.controls();
    if (!globe || !controls) return;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.6;
    globe.pointOfView({ lat: 12, lng: 24, altitude: 1.5 }, 1000);
  };

  return (
    <div ref={wrapperRef} className="globe-stage h-full w-full overflow-hidden" aria-label="Global API traffic map">
      <div className="globe-halo" aria-hidden="true" />
      <Globe
        ref={globeRef}
        onGlobeReady={startRotation}
        width={size.width}
        height={size.height}
        backgroundColor="rgba(0,0,0,0)"
        showAtmosphere
        atmosphereColor="#9cc3e8"
        atmosphereAltitude={0.17}
        globeImageUrl="/images/earth-graphite-bright.jpg"
        showGraticules
        pointsData={points}
        pointLat="lat"
        pointLng="lng"
        pointAltitude={(item) => 0.06 + (item as GlobePoint).size * 0.25}
        pointRadius={0.3}
        pointColor={(item) => (item as GlobePoint).status === "healing" ? "#ff9d8a" : "#8fc3e8"}
        pointLabel={(item) => `<div class="globe-label">${(item as GlobePoint).label}</div>`}
        arcsData={arcs}
        arcColor={(item: object) =>
          (item as { order: number }).order % 3 === 0
            ? ["rgba(143,195,232,.02)", "rgba(168,214,255,.65)"]
            : ["rgba(127,175,208,.03)", "rgba(147,195,229,.5)"]
        }
        arcDashLength={0.3}
        arcDashGap={0.7}
        arcDashAnimateTime={(item) => 1200 + (item as { order: number }).order * 90}
        arcStroke={0.38}
        arcAltitudeAutoScale={0.45}
        ringsData={rings}
        ringLat="lat"
        ringLng="lng"
        ringColor={(item: object) =>
          (item as GlobePoint).status === "healing"
            ? (time: number) => `rgba(255,157,138,${(1 - time) * 0.8})`
            : (time: number) => `rgba(143,195,232,${(1 - time) * 0.32})`
        }
        ringMaxRadius={(item) => ((item as GlobePoint).status === "healing" ? 4.5 : 3)}
        ringPropagationSpeed={2.4}
        ringRepeatPeriod={(item) => ((item as GlobePoint).status === "healing" ? 750 : 1500)}
      />
    </div>
  );
}