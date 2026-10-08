"use client";

import { useEffect, useState } from "react";
import { AdminHeader } from "@/components/management/admin-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

interface Company {
  id: string;
  name: string;
}

interface OdooCompany {
  id: number;
  name: string;
}

interface RestaurantLocation {
  id: string;
  name: string;
  odoo_company_id?: number | null;
}

interface ConnectionData {
  connection: {
    id: string;
    base_url: string;
    database_name: string;
    username: string;
    timezone: string;
    odoo_company_ids: number[] | null;
    updated_at: string;
  } | null;
  has_api_key: boolean;
}

export default function OdooPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");
  const [connectionData, setConnectionData] = useState<ConnectionData | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [testLoading, setTestLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    companies?: OdooCompany[];
    error?: string;
  } | null>(null);

  const [baseUrl, setBaseUrl] = useState("");
  const [databaseName, setDatabaseName] = useState("");
  const [username, setUsername] = useState("");
  const [timezone, setTimezone] = useState("");
  const [apiKey, setApiKey] = useState("");

  const [accessibleCompanies, setAccessibleCompanies] = useState<OdooCompany[]>(
    []
  );
  const [selectedOdooCompanyIds, setSelectedOdooCompanyIds] = useState<
    number[]
  >([]);
  const [locations, setLocations] = useState<RestaurantLocation[]>([]);
  const [companyLocationMap, setCompanyLocationMap] = useState<
    Record<number, string>
  >({});
  const [saveMappingLoading, setSaveMappingLoading] = useState(false);

  const { toast } = useToast();

  useEffect(() => {
    loadCompanies();
  }, []);

  useEffect(() => {
    if (selectedCompanyId) {
      loadConnection();
      loadLocations();
    }
  }, [selectedCompanyId]);

  const loadCompanies = async () => {
    try {
      const response = await fetch("/api/admin/companies");
      if (!response.ok) throw new Error("Failed to load companies");
      const data = await response.json();
      setCompanies(data);
      if (data.length > 0) {
        setSelectedCompanyId(data[0].id);
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to load companies",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const loadConnection = async () => {
    if (!selectedCompanyId) return;
    try {
      const response = await fetch(
        `/api/admin/odoo/connection?company_id=${selectedCompanyId}`
      );
      if (!response.ok) throw new Error("Failed to load connection");
      const data = await response.json();
      setConnectionData(data);

      if (data.connection) {
        setBaseUrl(data.connection.base_url);
        setDatabaseName(data.connection.database_name);
        setUsername(data.connection.username);
        setTimezone(data.connection.timezone);
        setSelectedOdooCompanyIds(data.connection.odoo_company_ids || []);
      } else {
        setBaseUrl("");
        setDatabaseName("");
        setUsername("");
        setTimezone("");
        setSelectedOdooCompanyIds([]);
      }
      setApiKey("");
      setTestResult(null);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to load connection",
        variant: "destructive",
      });
    }
  };

  const loadLocations = async () => {
    if (!selectedCompanyId) return;
    try {
      const response = await fetch(
        `/api/admin/odoo/location-mapping?company_id=${encodeURIComponent(selectedCompanyId)}`
      );
      if (response.ok) {
        const data = await response.json();
        setLocations(data.locations);

        // Build initial map from existing mappings
        const map: Record<number, string> = {};
        for (const loc of data.locations) {
          if (loc.odoo_company_id) {
            map[loc.odoo_company_id] = loc.id;
          }
        }
        setCompanyLocationMap(map);
      }
    } catch (error) {
      console.error("Failed to load locations:", error);
    }
  };

  const handleTestConnection = async () => {
    if (!baseUrl || !databaseName || !username || !apiKey) {
      toast({
        title: "Validation Error",
        description: "Please fill in all connection fields",
        variant: "destructive",
      });
      return;
    }

    setTestLoading(true);
    setTestResult(null);

    try {
      const response = await fetch("/api/admin/odoo/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base_url: baseUrl,
          database_name: databaseName,
          username,
          api_key: apiKey,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setTestResult({ success: true, companies: data.companies });
        setAccessibleCompanies(data.companies);
        toast({
          title: "Success",
          description: "Connection test succeeded",
        });
      } else {
        setTestResult({ success: false, error: data.error });
        toast({
          title: "Connection Test Failed",
          description: data.error,
          variant: "destructive",
        });
      }
    } catch (error) {
      setTestResult({ success: false, error: "Network error" });
      toast({
        title: "Error",
        description: "Failed to test connection",
        variant: "destructive",
      });
    } finally {
      setTestLoading(false);
    }
  };

  const handleSave = async () => {
    if (
      !selectedCompanyId ||
      !baseUrl ||
      !databaseName ||
      !username ||
      !timezone ||
      !apiKey
    ) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    setSaveLoading(true);

    try {
      const response = await fetch("/api/admin/odoo/connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_id: selectedCompanyId,
          base_url: baseUrl,
          database_name: databaseName,
          username,
          timezone,
          api_key: apiKey,
          odoo_company_ids:
            selectedOdooCompanyIds.length > 0
              ? selectedOdooCompanyIds
              : undefined,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        toast({
          title: "Success",
          description: "Connection saved successfully",
        });
        setApiKey("");
        setAccessibleCompanies(data.accessible_companies);
        await loadConnection();
        await loadLocations();
      } else {
        if (data.accessible_companies) {
          setAccessibleCompanies(data.accessible_companies);
        }
        toast({
          title: "Save Failed",
          description: data.error,
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to save connection",
        variant: "destructive",
      });
    } finally {
      setSaveLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AdminHeader
        title="Odoo Integration"
        description="Configure Odoo connection and company mapping"
      />

      <Card>
        <CardHeader>
          <CardTitle>Workspace Selection</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label htmlFor="company">Milton Workspace (Company)</Label>
            <Select
              value={selectedCompanyId}
              onValueChange={setSelectedCompanyId}
            >
              <SelectTrigger id="company">
                <SelectValue placeholder="Select a workspace" />
              </SelectTrigger>
              <SelectContent>
                {companies.map((company) => (
                  <SelectItem key={company.id} value={company.id}>
                    {company.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {selectedCompanyId && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Connection Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {connectionData?.connection && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Last updated:{" "}
                    {new Date(
                      connectionData.connection.updated_at
                    ).toLocaleString()}
                    {" | "}
                    API Key stored: {connectionData.has_api_key ? "Yes" : "No"}
                  </AlertDescription>
                </Alert>
              )}

              <div className="grid gap-4">
                <div className="space-y-2">
                  <Label htmlFor="baseUrl">Base URL</Label>
                  <Input
                    id="baseUrl"
                    placeholder="https://your-instance.odoo.com"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="databaseName">Database Name</Label>
                  <Input
                    id="databaseName"
                    placeholder="your-database"
                    value={databaseName}
                    onChange={(e) => setDatabaseName(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    placeholder="user@example.com"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="timezone">Timezone (IANA)</Label>
                  <Input
                    id="timezone"
                    placeholder="America/Mexico_City"
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="apiKey">
                    API Key (write-only, never prefilled)
                  </Label>
                  <Input
                    id="apiKey"
                    type="password"
                    placeholder="Enter API key to update"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                  <p className="text-sm text-muted-foreground">
                    The API key is encrypted and never displayed. Enter a new
                    key to update.
                  </p>
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={handleTestConnection}
                  disabled={
                    testLoading ||
                    !baseUrl ||
                    !databaseName ||
                    !username ||
                    !apiKey
                  }
                  variant="outline"
                >
                  {testLoading && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Test Connection
                </Button>

                <Button
                  onClick={handleSave}
                  disabled={
                    saveLoading ||
                    !baseUrl ||
                    !databaseName ||
                    !username ||
                    !timezone ||
                    !apiKey
                  }
                >
                  {saveLoading && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Save Connection
                </Button>
              </div>

              {testResult && (
                <Alert variant={testResult.success ? "default" : "destructive"}>
                  {testResult.success ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <XCircle className="h-4 w-4" />
                  )}
                  <AlertDescription>
                    {testResult.success ? (
                      <>
                        Connection successful! Found{" "}
                        {testResult.companies?.length} companies.
                      </>
                    ) : (
                      testResult.error
                    )}
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          {accessibleCompanies.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Odoo Companies</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <Label>Select Odoo Companies to Sync</Label>
                  <div className="space-y-2">
                    {accessibleCompanies.map((company) => (
                      <div
                        key={company.id}
                        className="flex items-center space-x-2"
                      >
                        <input
                          type="checkbox"
                          id={`company-${company.id}`}
                          checked={selectedOdooCompanyIds.includes(company.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedOdooCompanyIds([
                                ...selectedOdooCompanyIds,
                                company.id,
                              ]);
                            } else {
                              setSelectedOdooCompanyIds(
                                selectedOdooCompanyIds.filter(
                                  (id) => id !== company.id
                                )
                              );
                            }
                          }}
                          className="h-4 w-4"
                        />
                        <label
                          htmlFor={`company-${company.id}`}
                          className="text-sm"
                        >
                          {company.name} (ID: {company.id})
                        </label>
                      </div>
                    ))}
                  </div>
                  <p className="text-sm text-muted-foreground mt-2">
                    Selected: {selectedOdooCompanyIds.length} of{" "}
                    {accessibleCompanies.length}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {locations.length > 0 && selectedOdooCompanyIds.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Company → Location Mapping</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Map each selected Odoo company to exactly one Milton
                    location. Orders from that Odoo company will land on the
                    mapped location, never guessed from till name.
                  </AlertDescription>
                </Alert>

                <div className="space-y-3">
                  {selectedOdooCompanyIds.map((companyId) => {
                    const company = accessibleCompanies.find(
                      (c) => c.id === companyId
                    );
                    return (
                      <div key={companyId} className="flex items-center gap-4">
                        <Label className="w-48 text-sm font-medium">
                          {company?.name || `Company ${companyId}`}:
                        </Label>
                        <Select
                          value={companyLocationMap[companyId] || ""}
                          onValueChange={(value) => {
                            setCompanyLocationMap((prev) => ({
                              ...prev,
                              [companyId]: value,
                            }));
                          }}
                        >
                          <SelectTrigger className="w-64">
                            <SelectValue placeholder="Select location" />
                          </SelectTrigger>
                          <SelectContent>
                            {locations.map((location) => (
                              <SelectItem key={location.id} value={location.id}>
                                {location.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  })}
                </div>

                <Button
                  onClick={async () => {
                    const unmapped = selectedOdooCompanyIds.filter(
                      (id) => !companyLocationMap[id]
                    );
                    if (unmapped.length > 0) {
                      toast({
                        title: "Validation Error",
                        description:
                          "All selected Odoo companies must be mapped to a location",
                        variant: "destructive",
                      });
                      return;
                    }

                    setSaveMappingLoading(true);
                    try {
                      const mappings = selectedOdooCompanyIds.map(
                        (companyId) => ({
                          odoo_company_id: companyId,
                          location_id: companyLocationMap[companyId],
                        })
                      );

                      const response = await fetch(
                        "/api/admin/odoo/location-mapping",
                        {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            company_id: selectedCompanyId,
                            mappings,
                          }),
                        }
                      );

                      if (response.ok) {
                        toast({
                          title: "Success",
                          description: "Location mapping saved successfully",
                        });
                        await loadLocations();
                      } else {
                        const data = await response.json();
                        toast({
                          title: "Save Failed",
                          description: data.error,
                          variant: "destructive",
                        });
                      }
                    } catch (error) {
                      toast({
                        title: "Error",
                        description: "Failed to save mapping",
                        variant: "destructive",
                      });
                    } finally {
                      setSaveMappingLoading(false);
                    }
                  }}
                  disabled={saveMappingLoading}
                >
                  {saveMappingLoading && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Save Mapping
                </Button>

                <div className="mt-4 text-sm text-muted-foreground">
                  <strong>Available locations:</strong>{" "}
                  {locations.map((l) => l.name).join(", ")}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
