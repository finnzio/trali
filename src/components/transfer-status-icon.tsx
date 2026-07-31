type TransferStatusIconProps = {
  loading: boolean;
  className?: string;
};

export function TransferStatusIcon({
  loading,
  className,
}: TransferStatusIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      data-loading={loading}
      fill="none"
      viewBox="0 0 24 24"
    >
      <path
        className="transfer-status-icon-path"
        d="M12 3 C12 7.5 12 13.5 12 18 C12 18 8 14 6 12 C6 12 10 16 12 18 C12 18 16 14 18 12"
        pathLength="57"
      />
    </svg>
  );
}
