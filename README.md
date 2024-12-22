# InstanceSerializer - Roblox Instance Serialization Tool

## Overview

`InstanceSerializer` is a robust TypeScript package that enables the serialization and deserialization of Roblox instances, making it ideal for storing, transferring, and restoring complex game data structures such as houses, models, or other object hierarchies. By converting Roblox instances into JSON, you can easily save and load your game data across sessions, or share it with other systems.

This tool is specifically built for use with **Roblox Studio** and utilizes the Roblox API to inspect and serialize various instance properties, including the instance's class name, name, properties, and children. It handles special cases like `MeshPart` objects (storing their `MeshId`), and supports many common instance properties such as `CFrame`, `Vector3`, `Color3`, and others. You can easily restore a serialized object back to its original state, including its child instances and property values.

## Key Features

- **Comprehensive Serialization**: Serializes Roblox instances and their properties into a JSON format for easy storage and transfer.
- **Deserialization Support**: Restores instances from serialized data, recreating their properties and children.
- **MeshPart Handling**: Special handling for `MeshPart` instances, saving their `MeshId` and restoring them properly.
- **Attachment Support**: Handles `Attachment` properties during serialization/deserialization.
- **Efficient Property Filtering**: Automatically filters out non-serializable or unnecessary properties like `Parent` and `RobloxLocked`.

## Use Cases

This package is particularly useful for scenarios where you need to:
- **Save and load game data**: Save complex structures like houses, buildings, or any object hierarchy.
- **Transfer data**: Share game objects across different servers or external systems.
- **Backup/Restore**: Create backups of complex objects or restore them to a previous state.

## Example Usage

Here's an example of how to serialize and deserialize a `Part` instance:

```ts
const part = new Instance("Part");
part.Position = new Vector3(0, 10, 0);
part.Color = new Color3(1, 0, 0);

// Serialize to JSON
const jsonString = await InstanceSerializer.toJSON(part);

// Deserialize back to a Part instance
const restoredPart = await InstanceSerializer.fromJSON(jsonString);
restoredPart.Parent = Workspace;
