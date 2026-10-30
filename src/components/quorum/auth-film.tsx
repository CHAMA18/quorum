/*
 * The same film runs behind both doors. A city at first light, the file
 * being printed, a hand signing it, and the record closing — one red line
 * carries the whole loop. It is deliberately quiet: the page's own type
 * stays the headline, the footage only gives the panel a pulse. The poster
 * holds the frame for reduced-motion visitors and wherever autoplay is
 * refused.
 */
export function AuthFilm({ compact = false }: { compact?: boolean }) {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const poster = `${basePath}/media/quorum-auth-poster.jpg`;
  const objectPosition = compact ? "50% 18%" : "50% 50%";
  const leftScrim = compact
    ? "linear-gradient(90deg, rgba(12,13,16,0.97) 0%, rgba(12,13,16,0.9) 34%, rgba(12,13,16,0.72) 72%, rgba(12,13,16,0.62) 100%)"
    : "linear-gradient(90deg, rgba(12,13,16,0.94) 0%, rgba(12,13,16,0.78) 34%, rgba(12,13,16,0.42) 72%, rgba(12,13,16,0.28) 100%)";
  const verticalScrim = compact
    ? "linear-gradient(180deg, rgba(12,13,16,0.68) 0%, rgba(12,13,16,0.24) 26%, rgba(12,13,16,0.34) 60%, rgba(12,13,16,0.94) 100%)"
    : "linear-gradient(180deg, rgba(12,13,16,0.6) 0%, rgba(12,13,16,0.06) 24%, rgba(12,13,16,0.1) 58%, rgba(12,13,16,0.9) 100%)";
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <video
        className="absolute inset-0 h-full w-full object-cover opacity-90 motion-reduce:hidden"
        style={{ objectPosition }}
        autoPlay
        muted
        loop
        playsInline
        disablePictureInPicture
        preload="metadata"
        poster={poster}
      >
        <source src={`${basePath}/media/quorum-auth-loop.mp4`} type="video/mp4" />
      </video>

      <img
        src={poster}
        alt=""
        className="absolute inset-0 hidden h-full w-full object-cover opacity-90 motion-reduce:block"
        style={{ objectPosition }}
      />

      <div className="absolute inset-0" style={{ background: leftScrim }} />
      <div className="absolute inset-0" style={{ background: verticalScrim }} />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 50% 45%, transparent 38%, rgba(12,13,16,0.55) 100%)",
        }}
      />
    </div>
  );
}
