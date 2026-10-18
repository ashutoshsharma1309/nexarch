-- The knowledge graph gained the generated project's own file tree, so a
-- directory is now a node in its own right: FOLDER CONTAINS its files and
-- subfolders. Additive — every existing node and edge keeps its meaning.
ALTER TYPE "GraphNodeType" ADD VALUE IF NOT EXISTS 'FOLDER';
