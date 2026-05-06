export namespace main {
	
	export class Config {
	    default_directory: string;
	    indent_guides: boolean;
	    order_directory: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Config(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.default_directory = source["default_directory"];
	        this.indent_guides = source["indent_guides"];
	        this.order_directory = source["order_directory"];
	    }
	}

}

