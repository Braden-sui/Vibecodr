import React, { useState } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import { motion } from "framer-motion";
import LiquidBackground from "@/src/components/LiquidBackground";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";

const Layout = () => {
    const [sidebarOpen, setSidebarOpen] = useState(() => (typeof window !== "undefined" ? window.innerWidth >= 768 : true));

    return (
        <div className="min-h-screen text-foreground font-sans selection:bg-accent/30">
            <LiquidBackground />

            {/* Desktop Sidebar */}
            <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

            {/* Toggle button */}
            <button
                type="button"
                onClick={() => setSidebarOpen((open) => !open)}
                className="fixed left-4 top-4 z-50 inline-flex items-center gap-2 rounded-full bg-card/90 backdrop-blur border border-border px-4 py-2 text-sm font-semibold shadow-vc-soft hover:border-border/70 transition-colors md:left-6"
                aria-pressed={sidebarOpen}
                aria-label={sidebarOpen ? "Hide navigation" : "Show navigation"}
            >
                {sidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
                <span className="hidden sm:inline">{sidebarOpen ? "Hide menu" : "Show menu"}</span>
                <span className="sm:hidden">Menu</span>
            </button>

            {/* Overlay for small screens */}
            {sidebarOpen && (
                <button
                    type="button"
                    className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm md:hidden"
                    aria-label="Close navigation overlay"
                    onClick={() => setSidebarOpen(false)}
                />
            )}

            {/* Main Content Area */}
            <main className={cn("min-h-screen transition-[padding] duration-300 ease-in-out", sidebarOpen ? "md:pl-64" : "md:pl-0")}>
                <div className="container mx-auto px-4 py-8 max-w-5xl">
                    {/* Shared Layout Context for smooth page transitions */}
                    <motion.div
                        layout
                        className="w-full"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 20 }}
                        transition={{ duration: 0.3, ease: "easeOut" }}
                    >
                        <Outlet />
                    </motion.div>
                </div>
            </main>
        </div>
    );
};

export default Layout;
