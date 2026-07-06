"use client"

import { createContext, useContext } from "react"

export type Section = "overview" | "trading" | "bot" | "bridge" | "payments" | "classroom" | "faucet" | "framework"
export type SectionContextType = { section: Section }

export const SectionContext = createContext<SectionContextType>({ section: "overview" })
export const useSection = () => useContext(SectionContext)
