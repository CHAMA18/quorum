"use client";

import { useEffect, useRef } from "react";

/**
 * The hero plate: a fourteen-second silent loop from the procurement floor —
 * a city at first light, the port, the medical store, the clinic, the server
 * room, the seal. It is a ground, not a feature: scrimmed well below the type,
 * and it only runs while it is on screen, the tab is visible, and the visitor
 * has not asked for less motion. The poster carries the frame everywhere else.
 */
export function HeroFilm() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const poster = `${basePath}/media/quorum-hero-poster.jpg`;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let onScreen = true;

    const sync = () => {
      if (reduce.matches || document.hidden || !onScreen) {
        video.pause();
        return;
      }
      // Autoplay can still be refused (data saver, low power); the poster
      // then holds the frame and nothing throws.
      void video.play().catch(() => undefined);
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry.isIntersecting;
        sync();
      },
      { rootMargin: "240px 0px" }
    );

    observer.observe(video);
    reduce.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    sync();

    return () => {
      observer.disconnect();
      reduce.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  return (
    <div className="hero-film" aria-hidden="true">
      <video
        ref={videoRef}
        className="hero-film__video"
        autoPlay
        muted
        loop
        playsInline
        disablePictureInPicture
        preload="metadata"
        poster={poster}
      >
        <source src={`${basePath}/media/quorum-hero-loop.mp4`} type="video/mp4" />
      </video>

      {/* Reduced motion, and any browser that refuses autoplay, get the
          graded still instead of a frozen first frame. */}
      <img className="hero-film__poster" src={poster} alt="" />

      <div className="hero-film__scrim" />
      <div className="hero-film__vignette" />
    </div>
  );
}
