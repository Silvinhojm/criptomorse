"use client"

import { createContext, useContext } from "react"

export type Section = "overview" | "decisions" | "proofs" | "agents" | "architecture" | "operator" | "debug"
export type SectionContextType = { section: Section }

export const SectionContext = createContext<SectionContextType>({ section: "overview" })
export const useSection = () => useContext(SectionContext)
