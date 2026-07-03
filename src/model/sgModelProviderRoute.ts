import { Model } from "sutando";
import { inspect, InspectOptions } from "util";

class SgModelProviderRoute extends Model {
    table = "model_provider_route";

    id!: number;
    model_id!: number;
    vendor_id!: number;
    vendor_model_id!: number | null;
    priority!: number;
    weight!: number;
    cost_weight!: number;
    enabled!: boolean;

    created_at!: Date;
    updated_at!: Date;

    [inspect.custom](depth: number, options: InspectOptions) {
        return JSON.stringify(this.toData(), null, 2);
    }
}

export default SgModelProviderRoute;
