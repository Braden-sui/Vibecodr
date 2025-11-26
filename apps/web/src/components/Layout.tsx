import React, { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import Sidebar from "./Sidebar";
import EtheriaSkyBackground from "@/src/components/EtheriaSkyBackground";
import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/lib/useReducedMotion";

const Layout = () => {
    const [sidebarOpen, setSidebarOpen] = useState(() => (typeof window !== "undefined" ? window.innerWidth >= 768 : true));
    const location = useLocation();
    const prefersReducedMotion = useReducedMotion();

    // Use pathname as key so animation only triggers on actual page changes, not tab switches
    const pageKey = location.pathname;

    return (
        <div className="min-h-screen text-foreground font-sans selection:bg-accent/30">
            <EtheriaSkyBackground />

            {/* Desktop Sidebar */}
            <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

            {/* Floating open button */}
            {!sidebarOpen && (
                <button
                    type="button"
                    onClick={() => setSidebarOpen(true)}
                    className="fixed bottom-6 right-6 z-50 flex h-12 w-12 items-center justify-center rounded-full vc-surface text-foreground hover:bg-card/80 transition-colors md:bottom-8 md:right-8"
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
                    {/* Smooth page transition - animates on route change, not on tab switches */}
                    <AnimatePresence mode="wait" initial={false}>
                        <motion.div
                            key={pageKey}
                            className="w-full"
                            initial={prefersReducedMotion ? undefined : { opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={prefersReducedMotion ? undefined : { opacity: 0, y: -8 }}
                            transition={{ 
                                duration: 0.25, 
                                ease: [0.25, 0.1, 0.25, 1] 
                            }}
                        >
                            <Outlet />
                        </motion.div>
                    </AnimatePresence>
                </div>
            </main>
        </div>
    );
};

export default Layout;
