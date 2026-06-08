export namespace main {
	
	export class Release {
	    version: string;
	    name: string;
	    publishedAt: string;
	    prerelease: boolean;
	    downloadURL: string;
	    releaseNotes: string;
	
	    static createFrom(source: any = {}) {
	        return new Release(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.version = source["version"];
	        this.name = source["name"];
	        this.publishedAt = source["publishedAt"];
	        this.prerelease = source["prerelease"];
	        this.downloadURL = source["downloadURL"];
	        this.releaseNotes = source["releaseNotes"];
	    }
	}

}

