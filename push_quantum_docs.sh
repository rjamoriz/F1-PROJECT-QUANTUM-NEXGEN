#!/bin/bash

# Navigate to project directory
cd "/Users/Ruben_MACPRO/Desktop/F1 Project NexGen"

# Add the files
git add docs/Quantum_Definition_Enhanced.md
git add docs/Quantum_Definition.md

# Commit with message
git commit -m "Enhanced Quantum Definition with spectacular Mermaid diagrams and LaTeX

- Added comprehensive Mermaid visualizations for all major concepts
- Formatted all mathematical expressions with proper LaTeX syntax
- Created new Quantum_Definition_Enhanced.md with complete visual overhaul
- Added visual flowcharts for QAOA workflow, active learning loop, system architecture
- Enhanced code examples with detailed comments and output examples
- Improved document structure with emojis and visual hierarchy
- Added C4 architecture diagram and complete technology stack visualization"

# Push to GitHub
git push origin main

echo "✅ Successfully pushed enhanced quantum documentation to GitHub!"
