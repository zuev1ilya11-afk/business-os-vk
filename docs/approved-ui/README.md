# Approved Business OS design — implementation contract

Approved by the owner in the implementation request of 2026-10-08. Canonical artifact: Business-OS-UX-Audit.zip, Library libfile_8708338a06a481919b0006d53a826a12 (file_00000000a8dc822fa7cca5459a93f25d). Local original: /workspace/scratch/59eaed6e4f64/audit-ui.

Read proposed/specimen.html, specimen.css and specimen.js for exact layouts; proposed/screens.json and this screen-contract.json enumerate every role/state. Open the matching proposed/<role>/<screen>-390.png and -1440.png before changing a renderer. Source-to-surface mapping: inventory-evidence.json, inventory-evidence.md and review-data.json. Synthetic examples in those files are design data ONLY and must never enter runtime screens.

## Boundaries

Keep existing classic-script architecture, existing handlers, API payloads, authorization, server persistence, salary/commission/deduction formulae, lifecycle, report finalization, upload transport, photo quality and Hands/Avito actions unchanged. Do not modify backend, migrations, RLS, roles, auth/session modules or financial-model modules. Existing valid action names, DOM handler hooks and field names survive presentation changes. All visible controls must use existing real actions. No mock/demo data in runtime.

Source main: a639db4dea71e605446c166ec96ca5af8abacc1a. Production: https://139.100.237.167/; public build 5fc09a8174db824cf6d4. Do not treat repository and Russian server as identical. 27 open PRs were inspected; none merged into this work. Previous local branch and untracked Python caches left untouched.

## Design system

bg #0e141c; surface #151d28; raised #1b2634; line #2a3543; text #edf2f8; muted #a3b1c3; link #91bfff; primary #a8ceff with ink #10223b; success #88d1b1; warning #efc282; error #f4a5ac. Radius 16px; button/input radius 10/9px; 44px minimum main touch controls; mobile input text 16px; status always has text. 360/390/430 mobile, 768 tablet, 1440 desktop. Master mobile first, management responsive. Keep content above fixed actions/nav/safe areas. Avoid repeated nested cards and saturated blue rectangles.

## Navigation and components

Master keeps Home / My orders / Schedule / Profile and home Days / New / Waiting with callbacks. Management mobile Home / Orders / Schedule / More; desktop sidebar with only existing permitted destinations. More exposes Team, Finance (existing can_view_finance), Avito and Profile; administrative tools separate from personal profile. Keep all existing menu destinations accessible and role preview exit safe.

Forms use client, works, planning, master, source and comment sections with existing inputs and handlers; mobile save remains reachable. Orders use sectioned main/client/works/agreement/planning/execution/report/finance/history, no forbidden data or action exposure. Date of callback and visit distinctly labeled. Filters compact but values and behavior persist. Finance seven existing tabs and all existing calculation semantics; no fake paid balance or duration/availability inference. Team and profiles retain allowed real actions. Loading/error/offline presentation preserves loaded data and entered form values.

## Evidence and implementation coverage

Track each screen contract in coverage.md with actual renderer, test and screenshot; blocked elements must name missing backend/data capability and safe existing alternative. A global stylesheet alone does not constitute completion of a screen whose composition changed. Compare implementation to approved PNGs, not to screenshots generated from implementation itself.
