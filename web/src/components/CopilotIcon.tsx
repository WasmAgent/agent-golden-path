// Copilot ShellBar Icon (20×20)
// Both paths use fill="currentColor" — controlled via CSS color (light/dark theme safe).
export function CopilotIcon({
  size = 20,
  color,
  className,
  style,
}: {
  size?: number
  color?: string
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ color, ...style }}
      aria-label="Copilot"
      role="img"
    >
      <path
        d="M14.4374 7.44572C12.7857 7.16729 12.2572 5.86954 12.0826 5.05785C12.0637 4.97763 11.9599 4.98235 11.9457 5.06257C11.6673 6.71426 10.3695 7.2428 9.55786 7.41741C9.47764 7.43628 9.48236 7.5401 9.56258 7.55426C11.2143 7.83269 11.7428 9.13044 11.9174 9.94213C11.9363 10.0224 12.0401 10.0176 12.0543 9.93741C12.3327 8.28572 13.6305 7.75718 14.4421 7.58258C14.5224 7.5637 14.5176 7.45988 14.4374 7.44572Z"
        fill="currentColor"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M6.5 2.39999C6.25899 2.39999 6.03083 2.50864 5.87892 2.69575L2.37892 7.00669C2.1491 7.28977 2.13976 7.69243 2.35621 7.98585L9.35621 17.4749C9.50702 17.6793 9.74596 17.8 10 17.8C10.254 17.8 10.493 17.6793 10.6438 17.4749L17.6438 7.98585C17.8602 7.69243 17.8509 7.28977 17.6211 7.00669L14.1211 2.69575C13.9692 2.50864 13.741 2.39999 13.5 2.39999H6.5ZM4.01142 7.53439L6.88096 3.99999H13.119L15.9886 7.53439L10 15.6524L4.01142 7.53439Z"
        fill="currentColor"
      />
    </svg>
  )
}
