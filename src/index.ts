import { HttpService, InsertService } from "@rbxts/services";

interface APIClass {
	Name: string;
	Members: APIMember[];
}

interface APIMember {
	Name: string;
	MemberType: string;
	Tags?: string[];
}

interface SerializedInstance {
	ClassName: string;
	Name: string;
	Properties: { [key: string]: unknown };
	Children: SerializedInstance[];
	MeshId?: string; // Add MeshId for MeshPart handling
}

class InstanceSerializer {
	private static properties: APIClass[] | undefined;

	private static readonly IGNORED_PROPERTIES = new Set([
		"ClassName",
		"Name",
		"Parent",
		"RobloxLocked",
		"Archivable",
		// Physical properties
		"Mass",
		"CenterOfMass",
		"AssemblyCenterOfMass",
		"ExtentsCFrame",
		"ExtentsSize",
		"MeshSize",
		"ResizeIncrement",
		// Capability-restricted properties
		"IsLoaded",
		"TimeLength",
		"PlaybackLoudness",
		"CollisionFidelity",
		"RenderFidelity",
		"DoubleSided",
		"WorldPosition",
		"WorldOrientation",
		"WorldCFrame",
		"Active",
	]);

	private static readonly READ_ONLY_PROPERTIES = new Set([
		"Mass",
		"CenterOfMass",
		"AssemblyCenterOfMass",
		"ExtentsCFrame",
		"ExtentsSize",
		"MeshSize",
		"ResizeIncrement",
		"IsLoaded",
		"TimeLength",
		"PlaybackLoudness",
		"Active",
	]);

	/**
	 * Fetches and caches the Roblox API properties from the API dump.
	 * @private
	 * @returns {Promise<APIClass[]>} Array of API classes containing property information
	 */
	private static async fetchProperties(): Promise<APIClass[]> {
		if (this.properties) return this.properties;

		const hash = await HttpService.GetAsync("http://setup.roproxy.com/versionQTStudio");
		const data = await HttpService.GetAsync(`http://setup.roproxy.com/${hash}-API-Dump.json`);
		const apiDump = HttpService.JSONDecode(data) as { Classes: APIClass[] };
		this.properties = apiDump.Classes;
		return this.properties;
	}

	/**
	 * Checks if a member has a specific tag.
	 * @private
	 * @param {string[] | undefined} tags - Array of tags to check
	 * @param {string} tag - The tag to look for
	 * @returns {boolean} True if the tag is present
	 */
	private static hasTag(tags: string[] | undefined, tag: string): boolean {
		if (!tags) return false;
		return tags.includes(tag);
	}

	/**
	 * Retrieves all valid properties from an instance.
	 * @private
	 * @param {Instance} instance - The instance to get properties from
	 * @returns {Promise<Map<string, unknown>>} Map of property names to their values
	 */
	private static async getInstanceProperties(instance: Instance): Promise<Map<string, unknown>> {
		const properties = new Map<string, unknown>();
		const apiClasses = await this.fetchProperties();

		for (const classData of apiClasses) {
			if (!instance.IsA(classData.Name as keyof Instances)) continue;

			for (const member of classData.Members) {
				if (member.MemberType !== "Property") continue;
				if (this.IGNORED_PROPERTIES.has(member.Name)) continue;

				// Skip deprecated, hidden, or non-scriptable properties
				if (
					this.hasTag(member.Tags, "Deprecated") ||
					this.hasTag(member.Tags, "Hidden") ||
					this.hasTag(member.Tags, "NotScriptable") ||
					this.hasTag(member.Tags, "ReadOnly")
				) {
					continue;
				}

				try {
					const value = instance[member.Name as keyof Instance];
					if (this.shouldSerializeProperty(member.Name, value)) {
						properties.set(member.Name, this.serializeProperty(value));
					}
				} catch {
					// Silently skip properties we can't access
					continue;
				}
			}
		}

		return properties;
	}

	/**
	 * Serializes an instance and all its descendants into a plain object structure.
	 * @param {Instance} instance - The instance to serialize
	 * @returns {Promise<SerializedInstance>} Serialized representation of the instance
	 */
	public static async serializeInstance(instance: Instance): Promise<SerializedInstance> {
		const serialized: SerializedInstance = {
			ClassName: instance.ClassName,
			Name: instance.Name,
			Properties: {},
			Children: [],
		};

		// Special handling for MeshPart
		if (instance.IsA("MeshPart")) {
			serialized.MeshId = instance.MeshId;
		}

		// Special handling for Attachments
		if (instance.IsA("Attachment")) {
			const properties = await this.getInstanceProperties(instance);
			for (const [key, value] of properties) {
				serialized.Properties[key] = value;
			}
		}

		// Serialize properties
		const properties = await this.getInstanceProperties(instance);
		for (const [key, value] of properties) {
			serialized.Properties[key] = value;
		}

		// Serialize children
		const children = instance.GetChildren();
		for (const child of children) {
			if (child.Archivable) {
				serialized.Children.push(await this.serializeInstance(child));
			}
		}

		return serialized;
	}

	/**
	 * Deserializes a plain object structure back into a Roblox instance.
	 * @param {SerializedInstance} data - The serialized instance data
	 * @returns {Promise<Instance>} The reconstructed instance
	 */
	public static async deserializeInstance(data: SerializedInstance): Promise<Instance> {
		let instance: Instance;

		if (data.ClassName === "Attachment") {
			instance = new Instance("Attachment");
			instance.Name = data.Name;

			// Set attachment properties
			for (const [propertyName, propertyValue] of pairs(data.Properties)) {
				try {
					instance[propertyName as never] = this.deserializeProperty(propertyValue) as never;
				} catch (err) {
					warn(`Failed to set Attachment property ${propertyName} on ${instance.Name}: ${err}`);
				}
			}
		} else if (data.ClassName === "MeshPart" && data.MeshId) {
			try {
				instance = InsertService.CreateMeshPartAsync(
					data.MeshId,
					Enum.CollisionFidelity.Default,
					Enum.RenderFidelity.Automatic,
				);
				instance.Name = data.Name;
			} catch (err) {
				warn(`Failed to create MeshPart: ${err}`);
				// Fallback to regular instance creation
				instance = new Instance(data.ClassName as keyof CreatableInstances);
				instance.Name = data.Name;
			}
		} else {
			// Regular instance creation
			instance = new Instance(data.ClassName as keyof CreatableInstances);
			instance.Name = data.Name;
		}

		// Set properties
		for (const [propertyName, propertyValue] of pairs(data.Properties)) {
			if (instance.IsA("MeshPart") && propertyName === "MeshId") continue; // Skip MeshId for MeshParts
			try {
				instance[propertyName as never] = this.deserializeProperty(propertyValue) as never;
			} catch (err) {
				warn(`Failed to set property ${propertyName} on ${instance.Name}: ${err}`);
			}
		}

		// Create children
		for (const childData of data.Children) {
			const child = await this.deserializeInstance(childData);
			child.Parent = instance;
		}

		return instance;
	}

	/**
	 * Determines if a property should be included in serialization.
	 * @private
	 * @param {string} propertyName - Name of the property
	 * @param {unknown} propertyValue - Value of the property
	 * @returns {boolean} True if the property should be serialized
	 */
	private static shouldSerializeProperty(propertyName: string, propertyValue: unknown): boolean {
		// Special handling for Attachment properties
		if (
			propertyName === "CFrame" ||
			propertyName === "Position" ||
			propertyName === "Orientation" ||
			propertyName === "Rotation" ||
			// Add ParticleEmitter properties
			propertyName === "Speed" ||
			propertyName === "SpreadAngle" ||
			propertyName === "Rate" ||
			propertyName === "RotSpeed" ||
			propertyName === "Acceleration" ||
			propertyName === "Drag" ||
			propertyName === "VelocityInheritance" ||
			propertyName === "Lifetime" ||
			propertyName === "Size" ||
			propertyName === "Transparency" ||
			propertyName === "LightEmission" ||
			propertyName === "LightInfluence" ||
			propertyName === "RotSpeed"
		) {
			return true;
		}

		if (propertyValue === undefined) return false;
		if (typeIs(propertyValue, "function")) return false;
		if (typeIs(propertyValue, "Instance")) return false;
		if (this.IGNORED_PROPERTIES.has(propertyName)) return false;

		const propertyType = typeOf(propertyValue);
		return (
			propertyType === "boolean" ||
			propertyType === "string" ||
			propertyType === "number" ||
			typeIs(propertyValue, "Vector3") ||
			typeIs(propertyValue, "CFrame") ||
			typeIs(propertyValue, "Color3") ||
			typeIs(propertyValue, "Vector2") ||
			typeIs(propertyValue, "UDim") ||
			typeIs(propertyValue, "UDim2") ||
			typeIs(propertyValue, "NumberRange") ||
			typeIs(propertyValue, "Rect") ||
			typeIs(propertyValue, "BrickColor") ||
			typeIs(propertyValue, "NumberSequence") || // Added for ParticleEmitter
			typeIs(propertyValue, "ColorSequence") || // Added for ParticleEmitter
			typeIs(propertyValue, "EnumItem")
		); // Added for various enum properties
	}

	/**
	 * Converts a Roblox datatype into a plain object representation.
	 * @private
	 * @param {unknown} value - The value to serialize
	 * @returns {unknown} Serialized representation of the value
	 */
	private static serializeProperty(value: unknown): unknown {
		if (typeIs(value, "Vector3")) {
			return {
				_type: "Vector3",
				X: value.X,
				Y: value.Y,
				Z: value.Z,
			};
		} else if (typeIs(value, "CFrame")) {
			const [x, y, z, r00, r01, r02, r10, r11, r12, r20, r21, r22] = value.GetComponents();
			return {
				_type: "CFrame",
				Position: [x, y, z],
				Rotation: [r00, r01, r02, r10, r11, r12, r20, r21, r22],
			};
		} else if (typeIs(value, "Color3")) {
			return {
				_type: "Color3",
				R: value.R,
				G: value.G,
				B: value.B,
			};
		} else if (typeIs(value, "NumberSequence")) {
			return {
				_type: "NumberSequence",
				Keypoints: value.Keypoints.map((k) => ({
					Time: k.Time,
					Value: k.Value,
					Envelope: k.Envelope,
				})),
			};
		} else if (typeIs(value, "ColorSequence")) {
			return {
				_type: "ColorSequence",
				Keypoints: value.Keypoints.map((k) => ({
					Time: k.Time,
					Value: {
						R: k.Value.R,
						G: k.Value.G,
						B: k.Value.B,
					},
				})),
			};
		} else if (typeIs(value, "EnumItem")) {
			return {
				_type: "EnumItem",
				EnumType: tostring(value.EnumType),
				Name: value.Name,
			};
		} else if (typeIs(value, "Vector2")) {
			return {
				_type: "Vector2",
				X: value.X,
				Y: value.Y,
			};
		} else if (typeIs(value, "NumberRange")) {
			return {
				_type: "NumberRange",
				Min: value.Min,
				Max: value.Max,
			};
		}

		return value;
	}

	/**
	 * Converts a serialized value back into its Roblox datatype.
	 * @private
	 * @param {unknown} value - The serialized value to deserialize
	 * @returns {unknown} The deserialized Roblox datatype
	 */
	private static deserializeProperty(value: unknown): unknown {
		if (typeIs(value, "table") && (value as { _type?: string })._type !== undefined) {
			const typedValue = value as { _type: string; [key: string]: unknown };

			switch (typedValue._type) {
				case "Vector3":
					return new Vector3(typedValue.X as number, typedValue.Y as number, typedValue.Z as number);
				case "CFrame":
					const position = typedValue.Position as number[];
					const rotation = typedValue.Rotation as number[];
					return new CFrame(
						position[0],
						position[1],
						position[2],
						rotation[0],
						rotation[1],
						rotation[2],
						rotation[3],
						rotation[4],
						rotation[5],
						rotation[6],
						rotation[7],
						rotation[8],
					);
				case "Color3":
					return new Color3(typedValue.R as number, typedValue.G as number, typedValue.B as number);
				case "NumberSequence":
					return new NumberSequence(
						(typedValue.Keypoints as Array<{ Time: number; Value: number; Envelope: number }>).map(
							(k) => new NumberSequenceKeypoint(k.Time, k.Value, k.Envelope),
						),
					);
				case "ColorSequence":
					return new ColorSequence(
						(
							typedValue.Keypoints as Array<{ Time: number; Value: { R: number; G: number; B: number } }>
						).map((k) => new ColorSequenceKeypoint(k.Time, new Color3(k.Value.R, k.Value.G, k.Value.B))),
					);
				case "EnumItem":
					const enumType = typedValue.EnumType as string;
					const enumName = typedValue.Name as string;
					return (Enum as unknown as { [key: string]: { [key: string]: unknown } })[enumType][enumName];
				case "Vector2":
					return new Vector2(typedValue.X as number, typedValue.Y as number);
				case "NumberRange":
					return new NumberRange(typedValue.Min as number, typedValue.Max as number);
			}
		}

		return value;
	}

	/**
	 * Serializes an instance to a JSON string.
	 * @param {Instance} instance - The instance to serialize
	 * @returns {Promise<string>} JSON string representation of the instance
	 */
	public static async toJSON(instance: Instance): Promise<string> {
		const serialized = await this.serializeInstance(instance);
		return HttpService.JSONEncode(serialized);
	}

	/**
	 * Creates an instance from a JSON string.
	 * @param {string} json - The JSON string to deserialize
	 * @returns {Promise<Instance>} The reconstructed instance
	 */
	public static fromJSON(json: string): Promise<Instance> {
		const data = HttpService.JSONDecode(json) as SerializedInstance;
		return this.deserializeInstance(data);
	}
}

export { InstanceSerializer, SerializedInstance };
