export namespace config {
	
	export class GitRecognitionConfig {
	    show_git_branch: boolean;
	
	    static createFrom(source: any = {}) {
	        return new GitRecognitionConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.show_git_branch = source["show_git_branch"];
	    }
	}
	export class Config {
	    default_directory: string;
	    indent_guides: boolean;
	    order_directory: boolean;
	    minimap: boolean;
	    theme: string;
	    show_timestamps: boolean;
	    git_recognition: GitRecognitionConfig;
	    soft_close: boolean;
	    zoom_insights: boolean;
	    minimal_pwd: boolean;
	    default_zoom: number;
	    custom_theme?: Record<string, string>;
	    terminal_word_wrap: boolean;
	    file_word_wrap: boolean;
	    scroll_speed: number;
	    preferred_shell: string;
	
	    static createFrom(source: any = {}) {
	        return new Config(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.default_directory = source["default_directory"];
	        this.indent_guides = source["indent_guides"];
	        this.order_directory = source["order_directory"];
	        this.minimap = source["minimap"];
	        this.theme = source["theme"];
	        this.show_timestamps = source["show_timestamps"];
	        this.git_recognition = this.convertValues(source["git_recognition"], GitRecognitionConfig);
	        this.soft_close = source["soft_close"];
	        this.zoom_insights = source["zoom_insights"];
	        this.minimal_pwd = source["minimal_pwd"];
	        this.default_zoom = source["default_zoom"];
	        this.custom_theme = source["custom_theme"];
	        this.terminal_word_wrap = source["terminal_word_wrap"];
	        this.file_word_wrap = source["file_word_wrap"];
	        this.scroll_speed = source["scroll_speed"];
	        this.preferred_shell = source["preferred_shell"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace database {
	
	export class DBColumn {
	    name: string;
	    type: string;
	
	    static createFrom(source: any = {}) {
	        return new DBColumn(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.type = source["type"];
	    }
	}
	export class DBTable {
	    name: string;
	    columns: DBColumn[];
	    rows: any[][];
	    row_count: number;
	
	    static createFrom(source: any = {}) {
	        return new DBTable(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.columns = this.convertValues(source["columns"], DBColumn);
	        this.rows = source["rows"];
	        this.row_count = source["row_count"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class DBSchema {
	    tables: DBTable[];
	
	    static createFrom(source: any = {}) {
	        return new DBSchema(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.tables = this.convertValues(source["tables"], DBTable);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace fullscreen {
	
	export class FileNode {
	    name: string;
	    path: string;
	    isDir: boolean;
	    children?: FileNode[];
	    ext: string;
	
	    static createFrom(source: any = {}) {
	        return new FileNode(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.isDir = source["isDir"];
	        this.children = this.convertValues(source["children"], FileNode);
	        this.ext = source["ext"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace perf {
	
	export class PerfData {
	    cpu_percent: number;
	    mem_used: number;
	    mem_total: number;
	    mem_percent: number;
	    disk_used: number;
	    disk_total: number;
	    disk_percent: number;
	    net_bytes_sent: number;
	    net_bytes_recv: number;
	    gpu_percent: number;
	    gpu_name: string;
	    gpu_available: boolean;
	
	    static createFrom(source: any = {}) {
	        return new PerfData(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.cpu_percent = source["cpu_percent"];
	        this.mem_used = source["mem_used"];
	        this.mem_total = source["mem_total"];
	        this.mem_percent = source["mem_percent"];
	        this.disk_used = source["disk_used"];
	        this.disk_total = source["disk_total"];
	        this.disk_percent = source["disk_percent"];
	        this.net_bytes_sent = source["net_bytes_sent"];
	        this.net_bytes_recv = source["net_bytes_recv"];
	        this.gpu_percent = source["gpu_percent"];
	        this.gpu_name = source["gpu_name"];
	        this.gpu_available = source["gpu_available"];
	    }
	}

}

export namespace plugins {
	
	export class ExternalPluginInfo {
	    id: string;
	    name: string;
	    description: string;
	    author: string;
	    version: string;
	    code: string;
	
	    static createFrom(source: any = {}) {
	        return new ExternalPluginInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.description = source["description"];
	        this.author = source["author"];
	        this.version = source["version"];
	        this.code = source["code"];
	    }
	}

}

export namespace ports {
	
	export class PortInfo {
	    protocol: string;
	    port: number;
	    pid: number;
	    process: string;
	    address: string;
	    state: string;
	
	    static createFrom(source: any = {}) {
	        return new PortInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.protocol = source["protocol"];
	        this.port = source["port"];
	        this.pid = source["pid"];
	        this.process = source["process"];
	        this.address = source["address"];
	        this.state = source["state"];
	    }
	}

}

export namespace problems {
	
	export class ProbData {
	    file: string;
	    line: number;
	    col: number;
	    sev: number;
	    code: string;
	    msg: string;
	
	    static createFrom(source: any = {}) {
	        return new ProbData(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.file = source["file"];
	        this.line = source["line"];
	        this.col = source["col"];
	        this.sev = source["sev"];
	        this.code = source["code"];
	        this.msg = source["msg"];
	    }
	}
	export class ProbResult {
	    cwd: string;
	    sources: string[];
	    items: ProbData[];
	
	    static createFrom(source: any = {}) {
	        return new ProbResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.cwd = source["cwd"];
	        this.sources = source["sources"];
	        this.items = this.convertValues(source["items"], ProbData);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace search {
	
	export class Result {
	    path: string;
	    line: number;
	    content: string;
	    is_name: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Result(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.line = source["line"];
	        this.content = source["content"];
	        this.is_name = source["is_name"];
	    }
	}

}

export namespace session {
	
	export class Tab {
	    type: string;
	    file_path?: string;
	    language?: string;
	    cwd?: string;
	
	    static createFrom(source: any = {}) {
	        return new Tab(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.file_path = source["file_path"];
	        this.language = source["language"];
	        this.cwd = source["cwd"];
	    }
	}

}

