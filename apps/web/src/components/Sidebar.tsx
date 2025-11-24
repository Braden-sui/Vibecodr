import React from "react";
import { UserButton, useUser } from "@clerk/clerk-react";
import { Link, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { Home, Settings, User, Code2, Compass } from "lucide-react";
import { cn } from "@/lib/utils";

interface SidebarProps {
    open: boolean;
    onClose?: () => void;
}

const Sidebar = ({ open, onClose }: SidebarProps) => {
    const { user, isLoaded } = useUser();
    const location = useLocation();

    const maybeClose = () => {
        if (typeof window !== "undefined" && window.innerWidth < 768) {
            onClose?.();
        }
    };

    const profileHandle = user?.username || user?.id || null;
    const profilePath = profileHandle ? `/u/${profileHandle}` : "/settings/profile";

    const navItems = [
        { icon: Home, label: "Home", path: "/" },
        { icon: Compass, label: "Discover", path: "/discover" },
        { icon: Code2, label: "Share a vibe", path: "/post/new" },
        { icon: User, label: "Profile", path: profilePath },
        { icon: Settings, label: "Settings", path: "/settings" },
    ];

    return (
        <motion.aside
            initial={false}
            animate={open ? { x: 0, opacity: 1 } : { x: -280, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            className={cn(
                "fixed left-0 top-0 z-50 h-screen w-64 vc-surface border-r-0 flex flex-col",
                open ? "pointer-events-auto" : "pointer-events-none"
            )}
            aria-hidden={!open}
        >
            {/* Logo Area */}
            <div className="p-6 flex items-center justify-between gap-2">
                <Link to="/" className="flex items-center gap-2 group" onClick={maybeClose}>
                    <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center text-white font-bold text-xl shadow-md group-hover:scale-105 transition-transform">
                        V
                    </div>
                    <span className="font-serif text-xl font-bold text-foreground tracking-tight">
                        vibecodr
                    </span>
                </Link>
                <button
                    type="button"
                    onClick={onClose}
                    className="ml-auto rounded-lg border border-border/60 px-3 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground hover:border-border transition-colors"
                    aria-label="Close navigation"
                >
                    Hide
                </button>
            </div>

            {/* Navigation */}
            <nav className="flex-1 px-4 space-y-2">
                {navItems.map((item) => {
                    const isActive =
                        location.pathname === item.path || location.pathname.startsWith(`${item.path}/`);
                    const Icon = item.icon;

                    return (
                        <Link
                            key={item.path}
                            to={item.path}
                            className="relative block"
                            onClick={maybeClose}
                        >
                            <div
                                className={cn(
                                    "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300 group",
                                    isActive
                                        ? "text-primary font-medium bg-secondary/50"
                                        : "text-muted-foreground hover:text-foreground hover:bg-secondary/30"
                                )}
                            >
                                <Icon
                                    className={cn(
                                        "w-5 h-5 transition-transform duration-300 group-hover:scale-110",
                                        isActive ? "stroke-[2.5px]" : "stroke-[1.5px]"
                                    )}
                                />
                                <span>{item.label}</span>

                                {/* Active Indicator */}
                                {isActive && (
                                    <motion.div
                                        layoutId="sidebar-active"
                                        className="absolute left-0 top-0 w-1 h-full bg-accent rounded-r-full"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                    />
                                )}
                            </div>
                        </Link>
                    );
                })}
            </nav>

            {/* User Profile / Footer */}
            <div className="p-6 border-t border-border/50">
                {isLoaded && user ? (
                    <div className="flex items-center gap-3 p-3 rounded-xl hover:bg-secondary/30 transition-colors">
                        <div className="flex items-center justify-center">
                            <UserButton
                                afterSignOutUrl="/"
                                appearance={{
                                    elements: {
                                        avatarBox: "w-10 h-10"
                                    }
                                }}
                            />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">
                                {user.fullName || user.username}
                            </p>
                            <Link
                                to={`/u/${user.username}`}
                                className="text-xs text-muted-foreground truncate hover:text-primary hover:underline block"
                            >
                                @{user.username}
                            </Link>
                        </div>
                    </div>
                ) : (
                    <div className="flex items-center gap-3 p-3">
                        <div className="w-10 h-10 rounded-full bg-secondary animate-pulse" />
                        <div className="flex-1 space-y-2">
                            <div className="h-4 w-20 bg-secondary rounded animate-pulse" />
                            <div className="h-3 w-16 bg-secondary rounded animate-pulse" />
                        </div>
                    </div>
                )}
            </div>
        </motion.aside>
    );
};

export default Sidebar;
