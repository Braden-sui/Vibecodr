import React from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import { motion } from "framer-motion";
import LiquidBackground from "@/src/components/LiquidBackground";

const Layout = () => {
    return (
        <div className="min-h-screen text-foreground font-sans selection:bg-accent/30">
            <LiquidBackground />

            {/* Desktop Sidebar */}
            <Sidebar />

            {/* Main Content Area */}
            <main className="md:pl-64 min-h-screen transition-[padding] duration-300 ease-in-out">
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

            {/* Mobile Nav Placeholder (To be implemented) */}
            <div className="md:hidden fixed bottom-0 left-0 right-0 bg-card border-t border-border p-4 flex justify-around z-50">
                {/* Simple mobile nav items can go here */}
                <span className="text-xs text-muted-foreground">Mobile Nav WIP</span>
            </div>
        </div>
    );
};

export default Layout;
