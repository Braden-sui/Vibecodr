import React, { useState } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import { motion } from "framer-motion";
import LiquidBackground from "@/src/components/LiquidBackground";
import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";

const Layout = () => {
    const [sidebarOpen, setSidebarOpen] = useState(() => (typeof window !== "undefined" ? window.innerWidth >= 768 : true));

    return (
        <div className="min-h-screen text-foreground font-sans selection:bg-accent/30">
            <LiquidBackground />

            {/* Desktop Sidebar */}
            <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

            {/* Floating open button */}
            {!sidebarOpen && (
                <button
                    type="button"
                    onClick={() => setSidebarOpen(true)}
                    className="fixed bottom-6 right-6 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-card/90 text-foreground backdrop-blur border border-border shadow-vc-soft hover:border-border/70 hover:bg-card transition-colors md:bottom-8 md:right-8"
                    aria-label="Show navigation"
                >
                    <Menu className="h-5 w-5" />
                </button>
            )}

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
            <main
                className={cn(
                    "min-h-screen transition-[padding] duration-300 ease-in-out",
                    sidebarOpen ? "md:pl-64" : "md:pl-0"
                )}
                style={{
                    transform: "translate3d(var(--water-parallax-x, 0), var(--water-parallax-y, 0), 0)",
                }}
            >
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
