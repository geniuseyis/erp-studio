import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function make(paths: ReactNode) {
  return function Icon({ size = 16, ...rest }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        {...rest}
      >
        {paths}
      </svg>
    );
  };
}

export const SearchIcon = make(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>);
export const SunIcon = make(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>);
export const MoonIcon = make(<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 7 7 0 1 0 20 14.5Z" />);
export const CloseIcon = make(<path d="M6 6l12 12M18 6 6 18" />);
export const ChevronDownIcon = make(<path d="m6 9 6 6 6-6" />);
export const ChevronUpIcon = make(<path d="m6 15 6-6 6 6" />);
export const ChevronRightIcon = make(<path d="m9 6 6 6-6 6" />);
export const SortIcon = make(<path d="m8 9 4-4 4 4M8 15l4 4 4-4" />);
export const ColumnsIcon = make(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M15 4v16" /></>);
export const DownloadIcon = make(<path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" />);
export const PlusIcon = make(<path d="M12 5v14M5 12h14" />);
export const MinusIcon = make(<path d="M5 12h14" />);
export const CheckIcon = make(<path d="m5 12.5 4.5 4.5L19 7.5" />);
export const AlertIcon = make(<><path d="M12 4 2.5 20h19L12 4Z" /><path d="M12 10v4M12 17.5v.01" /></>);
export const InfoIcon = make(<><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.01" /></>);
export const MenuIcon = make(<path d="M4 7h16M4 12h16M4 17h16" />);
export const HomeIcon = make(<path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1v-8Z" />);
export const BoxIcon = make(<><path d="m3 7.5 9-4.5 9 4.5v9L12 21l-9-4.5v-9Z" /><path d="m3 7.5 9 4.5 9-4.5M12 12v9" /></>);
export const ArrowsIcon = make(<path d="M4 8h13m0 0-3-3m3 3-3 3M20 16H7m0 0 3-3m-3 3 3 3" />);
export const ClipboardIcon = make(<><rect x="5" y="5" width="14" height="16" rx="2" /><path d="M9 5V3.5h6V5M9 11h6M9 15h4" /></>);
export const UsersIcon = make(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.5a6.5 6.5 0 0 1 3.5 5.5" /></>);
export const SettingsIcon = make(<><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4 5.3 5.3" /></>);
export const LogoutIcon = make(<path d="M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 16l4-4-4-4M14 12H4" />);
export const PanelIcon = make(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></>);
export const EditIcon = make(<path d="M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4" />);
export const RefreshIcon = make(<path d="M20 11a8 8 0 0 0-14.5-4M4 4v4h4M4 13a8 8 0 0 0 14.5 4M20 20v-4h-4" />);
export const ArrowInIcon = make(<path d="M12 4v12m0 0-5-5m5 5 5-5M5 20h14" />);
export const ArrowOutIcon = make(<path d="M12 16V4m0 0L7 9m5-5 5 5M5 20h14" />);
export const ScaleIcon = make(<><path d="M12 4v16M7 20h10M5 8h14" /><path d="m5 8-3 6a3 3 0 0 0 6 0L5 8ZM19 8l-3 6a3 3 0 0 0 6 0l-3-6Z" /></>);
export const LockIcon = make(<><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>);
export const UnlockIcon = make(<><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 7.5-2" /></>);
export const SawIcon = make(<><path d="M3 15 15 3l6 6L9 21l-2-2 2-2-2-2-2 2-2-2Z" /><path d="m13 9 2 2" /></>);
export const ShelfIcon = make(<><path d="M4 4v16M20 4v16M4 9h16M4 15h16" /></>);
export const ClockIcon = make(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>);
export const TagIcon = make(<><path d="M3 12V4h8l10 10-8 8L3 12Z" /><circle cx="7.5" cy="8.5" r="1.5" /></>);
export const ArrowRightIcon = make(<path d="M5 12h14m0 0-5-5m5 5-5 5" />);
export const SparkIcon = make(<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />);
export const EyeIcon = make(<><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></>);
export const EyeOffIcon = make(<><path d="M4 4l16 16M10.6 6.1A9.6 9.6 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3 3.6M6.4 7.6A16.6 16.6 0 0 0 2.5 12S6 18 12 18a9 9 0 0 0 4-.9" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>);
