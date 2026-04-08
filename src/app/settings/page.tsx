'use client';

import { useState } from 'react';
import { Save } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

export default function SettingsPage() {
  const [companyName, setCompanyName] = useState('');
  const [brandingColor, setBrandingColor] = useState('#1B5E96');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await fetch('/api/auth/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: companyName,
          report_branding_color: brandingColor,
        }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (error) {
      console.error('Failed to save:', error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-8">Settings</h1>

      {/* Company & Branding */}
      <Card className="mb-6">
        <CardHeader>
          <h3 className="text-sm font-semibold text-gray-900">Company & Branding</h3>
          <p className="text-xs text-gray-500">Used for white-label PDF reports</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Company Name</label>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Your consulting firm name"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Brand Color</label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={brandingColor}
                onChange={(e) => setBrandingColor(e.target.value)}
                className="h-10 w-16 rounded cursor-pointer"
              />
              <span className="text-sm text-gray-500">{brandingColor}</span>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Company Logo</label>
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
              <p className="text-sm text-gray-500">Drag & drop your logo or click to upload</p>
              <p className="text-xs text-gray-400 mt-1">PNG or SVG, max 2MB</p>
            </div>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Changes'}
          </button>
        </CardContent>
      </Card>

      {/* Plan Info */}
      <Card>
        <CardHeader>
          <h3 className="text-sm font-semibold text-gray-900">Your Plan</h3>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">Free Plan</p>
              <p className="text-xs text-gray-500">3 orgs, 10 scans/month</p>
            </div>
            <button className="px-4 py-2 text-sm font-medium text-blue-600 border border-blue-600 rounded-lg hover:bg-blue-50">
              Upgrade
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
