import React, { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import api from "../lib/api";
import { Shield, LogOut, Clock, FolderOpen, Archive, Search, Plus, Trash2, Eye, Edit2 } from "lucide-react";

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [cases, setCases] = useState([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("ALL");

  useEffect(() => {
    api.get("/cases").then((res) => setCases(res.data)).catch(console.error);
  }, []);

  const stats = {
    pending: cases.filter((c) => user?.role === "admin" ? c.status === "PENDING" : false).length,
    opened: cases.filter((c) => c.status === "OPENED").length,
    closed: cases.filter((c) => c.status === "CLOSED").length,
  };

  const filteredCases = cases.filter((c) => {
    const matchesSearch = c.case_name.toLowerCase().includes(search.toLowerCase()) ||
                          c.case_id.toLowerCase().includes(search.toLowerCase()) ||
                          c.division.toLowerCase().includes(search.toLowerCase());
    if (filter === "ALL") return matchesSearch;
    return matchesSearch && c.status === filter;
  });

  return (
    <div className="min-h-screen bg-[#061326] text-[#e7edf6] font-sans antialiased relative scc-scanlines scc-vignette">
      {/* Top Banner Header */}
      <header className="bg-[#0b1b33] border-b border-[#1c3557] px-6 py-4 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-3">
          <Shield className="h-8 w-7 text-[#d4b25a]" />
          <div>
            <h1 className="font-display font-bold text-lg uppercase tracking-wider leading-none">
              State Crime Command
            </h1>
            <p className="font-display text-[10px] uppercase tracking-[0.15em] text-[#8ba0bd] mt-1">
              NSW Police Force — Case File Tracker
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-xs font-mono text-[#8ba0bd] uppercase">Agent: {user?.username}</p>
            <p className="text-[10px] font-display uppercase tracking-wider text-[#d4b25a]">{user?.role}</p>
          </div>
          <button onClick={logout} className="p-2 hover:bg-[#1c3557] rounded text-[#f1a8a8] transition-colors cursor-pointer">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Main Grid View Dashboard Container */}
      <main className="max-w-7xl mx-auto p-6 flex flex-col gap-6">
        {/* Metric Cards Layout Panels Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-[#0b1b33]/60 border border-[#1c3557] rounded-lg p-4 flex items-center justify-between shadow-lg relative">
            <div className="absolute top-0 left-0 w-1 h-full bg-amber-500 rounded-l-lg" />
            <div>
              <p className="text-2xl font-mono font-bold text-amber-500">{stats.pending}</p>
              <p className="text-xs uppercase tracking-wider text-[#8ba0bd] font-medium mt-0.5">Pending Review</p>
            </div>
            <Clock className="h-8 w-8 text-amber-500/20" />
          </div>

          <div className="bg-[#0b1b33]/60 border border-[#1c3557] rounded-lg p-4 flex items-center justify-between shadow-lg relative">
            <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500 rounded-l-lg" />
            <div>
              <p className="text-2xl font-mono font-bold text-emerald-500">{stats.opened}</p>
              <p className="text-xs uppercase tracking-wider text-[#8ba0bd] font-medium mt-0.5">Opened Cases</p>
            </div>
            <FolderOpen className="h-8 w-8 text-emerald-500/20" />
          </div>

          <div className="bg-[#0b1b33]/60 border border-[#1c3557] rounded-lg p-4 flex items-center justify-between shadow-lg relative">
            <div className="absolute top-0 left-0 w-1 h-full bg-blue-500 rounded-l-lg" />
            <div>
              <p className="text-2xl font-mono font-bold text-blue-500">{stats.closed}</p>
              <p className="text-xs uppercase tracking-wider text-[#8ba0bd] font-medium mt-0.5">Closed Cases</p>
            </div>
            <Archive className="h-8 w-8 text-blue-500/20" />
          </div>
        </div>

        {/* Data Search Modules Filter Deck Block */}
        <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-[#0b1b33]/30 border border-[#1c3557] p-4 rounded-lg">
          <div className="relative w-full md:max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#4f6b8c]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search intelligence index tracks…"
              className="w-full bg-[#102540] border border-[#1c3557] rounded pl-10 pr-3 py-1.5 text-xs text-[#e7edf6] focus:outline-none focus:border-[#d4b25a] transition-colors"
            />
          </div>

          <div className="flex gap-2 w-full md:w-auto overflow-x-auto">
            {["ALL", "PENDING", "OPENED", "CLOSED"].map((t) => (
              <button
                key={t}
                onClick={() => setFilter(t)}
                className={`px-3 py-1.5 rounded text-[10px] uppercase font-bold tracking-wider transition-colors cursor-pointer border ${
                  filter === t
                    ? "bg-[#d4b25a] border-[#d4b25a] text-[#0b1b33]"
                    : "bg-[#102540] border-[#1c3557] text-[#8ba0bd] hover:border-[#4f6b8c]"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Intelligence Ledger Table Grid */}
        <div className="bg-[#0b1b33]/40 border border-[#1c3557] rounded-lg overflow-x-auto shadow-xl">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#1c3557] bg-[#102540]/50 text-[10px] uppercase tracking-wider text-[#8ba0bd] font-bold">
                <th className="px-4 py-3">Case ID</th>
                <th className="px-4 py-3">Operation Title</th>
                <th className="px-4 py-3">Division Unit</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1c3557]/40 font-mono text-xs">
              {filteredCases.map((c) => (
                <tr key={c.id || Math.random()} className="hover:bg-[#102540]/30 transition-colors">
                  <td className="px-4 py-3 text-[#d4b25a] font-bold">{c.case_id || "N/A"}</td>
                  <td className="px-4 py-3 font-sans text-sm text-[#e7edf6]">{c.case_name || "Untitled"}</td>
                  <td className="px-4 py-3 font-sans text-[#8ba0bd]">{c.division || "Unassigned"}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide border ${
                        c.status === "OPENED"
                          ? "bg-emerald-950/40 border-emerald-800 text-emerald-400"
                          : c.status === "CLOSED"
                            ? "bg-blue-950/40 border-blue-800 text-blue-400"
                            : "bg-amber-950/40 border-amber-800 text-amber-400"
                      }`}
                    >
                      {c.status || "PENDING"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-sans">
                    <div className="flex gap-2 justify-end">
                      <button className="p-1 hover:bg-[#1c3557] rounded text-[#8ba0bd] transition-colors cursor-pointer bg-transparent border-none shadow-none">
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      <button className="p-1 hover:bg-[#1c3557] rounded text-blue-400 transition-colors cursor-pointer bg-transparent border-none shadow-none">
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      <button className="p-1 hover:bg-[#1c3557] rounded text-rose-400 transition-colors cursor-pointer bg-transparent border-none shadow-none">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredCases.length === 0 && (
                <tr>
                  <td colSpan="5" className="px-4 py-8 text-center text-sm font-sans text-[#4f6b8c] uppercase tracking-wider">
                    No intelligence records found matching criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
