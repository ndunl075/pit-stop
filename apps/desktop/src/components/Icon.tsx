export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    play: <path d="m9 5 11 7-11 7z" />,
    pause: (
      <>
        <path d="M8 5v14M16 5v14" />
      </>
    ),
    sound: (
      <>
        <path d="M11 5 6 9H3v6h3l5 4zM15 8q5 4 0 8M18 5q8 7 0 14" />
      </>
    ),
    mute: (
      <>
        <path d="M11 5 6 9H3v6h3l5 4zM16 9l6 6m0-6-6 6" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2" />
      </>
    ),
    expand: <path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6" />,
    pin: (
      <>
        <path d="m8 3 8 0-1 7 4 4H5l4-4zm4 11v8" />
      </>
    ),
    reset: (
      <>
        <path d="M3 5v6h6M4 10a8 8 0 1 1 0 6" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    link: (
      <>
        <path d="m10 14 4-4M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6m0-10v1" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.info}
    </svg>
  );
}
