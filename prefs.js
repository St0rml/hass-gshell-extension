import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import GObject from "gi://GObject";
import Gdk from "gi://Gdk";
import Secret from 'gi://Secret';

import * as Utils from './utils.js';
import * as Settings from './settings.js';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';



var DraggableActionRow = GObject.registerClass ({
    GTypeName: "DraggableActionRow"
}, class DraggableActionRow extends Adw.ActionRow {
    constructor(...args) {
        super(...args);
        this.entity_id = null;
    }

    getEntityId() {
        return this.entity_id;
    }

    setEntityId(entity_id) {
        this.entity_id = entity_id;
    }
});

class SettingsPage {
    constructor(type, window, mscOptions) {
        if (type !== "togglable" && type !== "runnable" && type !== "sensor")
            throw new Error(`Type ${type} is not supported in SettingsPage`)

        this.type = type;
        this.window = window;
        this._mscOptions = mscOptions;
        this.page = null;
        this.group = null;
        this.checkedListBox = null;
        this.unCheckedListBox = null;
        this.drop_target = null;
    }

    get pageConfig() {
        let title;
        let iconName;
        switch (this.type) {
            case "togglable":
                title = _('Togglables');
                iconName = "system-shutdown-symbolic";
                break;
            case "runnable":
                title = _('Runnables');
                iconName = "system-shutdown-symbolic";
                break;
            case "sensor":
                title = _('Sensors');
                iconName = "weather-clear-symbolic";
                break;
        }
        return {
            title: title,
            iconName: iconName
        }
    }

    build() {
        this.page = new Adw.PreferencesPage({
            title: this.pageConfig.title,
            icon_name: this.pageConfig.iconName,
        });

        this.group = new Adw.PreferencesGroup({ title: _(`Choose which ${this.type}s should appear in the menu:`)});
        this.checkedListBox = new Gtk.ListBox({css_classes: ["boxed-list"],selection_mode: "none"})
        this.unCheckedListBox = new Gtk.ListBox({css_classes: ["boxed-list"],selection_mode: "none"})
        this.group.add(this.checkedListBox)
        this.group.add(this.unCheckedListBox)
        this.page.add(this.group);
        this.window.add(this.page);
        Utils.connectSettings([Settings.HASS_ENTITIES_CACHE], this.refresh.bind(this));
        this.drop_target = Gtk.DropTarget.new(Gtk.ListBoxRow, Gdk.DragAction.MOVE);
        this.checkedListBox.add_controller(this.drop_target);
        this.refresh();
    }

    refresh(entries=null) {
        this.deleteRows();
        if (!entries) {
            Utils.getEntitiesByType(
                this.type,
                (results) => this.refresh(results),
                () => this.refresh([])
            );
            return;
        }

        if (!entries.length) {
            let row = SettingsPage.createTextRow(
                _(`No ${this.type} found. Please check your Home-Assistant connection settings.`)
            );
            this.unCheckedListBox.append(row);
            return;
        }

        let enabledEntities = this._mscOptions.getEnabledByType(this.type);
        for (let entry of entries) {
            let row = SettingsPage.createEntityRow(
                entry,
                enabledEntities.includes(entry.entity_id),
                this.onToggle)
            if (enabledEntities.includes(entry.entity_id)) {
                this.checkedListBox.append(row);
            } else {
                this.unCheckedListBox.append(row);
            }
        }

        this.applyDnD(this.checkedListBox);
    }

    onToggle = (entity, row, isChecked) => {
        Utils._log(
            "%s %s (%s) as panel entry",
            [isChecked ? "Check" : "Uncheck", entity.name, entity.entity_id]
        );
        
        let currentEntities = this._mscOptions.getEnabledByType(this.type);
        let index = currentEntities.indexOf(entity.entity_id);
        Utils._log(
            "%s (%s) index is  %s in currentEntities",
            [ entity.name, entity.entity_id, index] 
        );
        if (index > -1 && !isChecked) { // then it exists and so we pop
            Utils._log(
                "Entry %s (%s) currently present, remove it",
                [entity.name, entity.entity_id]
            );
            this.checkedListBox.remove(row);
            this.unCheckedListBox.append(
                SettingsPage.createEntityRow(
                    entity,
                    isChecked,
                    this.onToggle
                )
            );
            currentEntities.splice(index, 1);
        }
        else if (index <= -1 && isChecked) {
            Utils._log(
                "Entry %s (%s) not currently present, add it",
                [entity.name, entity.entity_id]
            );
            this.unCheckedListBox.remove(row);
            this.checkedListBox.append(
                SettingsPage.createEntityRow(
                    entity,
                    isChecked,
                    this.onToggle
                )
            );
            currentEntities.push(entity.entity_id);
        }
        else {
            Utils._log(
                "Entry %s (%s) currently %s, no change",
                [entity.name, entity.entity_id, isChecked ? "present" : "not present"]
            );
            return;
        }
        this._mscOptions.setEnabledByType(this.type, currentEntities);
        this.applyDnD(this.checkedListBox);
        Utils._log(
            "%s entries enabled: %s",
            [this._mscOptions.getEnabledByType(this.type).length, this._mscOptions.getEnabledByType(this.type).join(', ')]
        );
    }

    deleteRows() {
        // Remove previously created rows
        this.unCheckedListBox.remove_all();
        this.checkedListBox.remove_all();
    }

    static createEntityRow(entity, checked, on_toggle) {
        let row = new DraggableActionRow({
            title: "%s (%s)".format(entity.name, entity.entity_id),
        });
        Utils._log("Pre setting entity id");
        row.setEntityId(entity.entity_id);
        Utils._log("%s", [row.getEntityId()]);
        if (checked) {
            row.add_prefix(
                new Gtk.Image({
                    icon_name: "list-drag-handle-symbolic",
                    css_classes: ["dim-label"],
                }),
            );
        }
        // Create a switch and bind its value to the `show-indicator` key
        let toggle = new Gtk.CheckButton({
            active: checked,
            valign: Gtk.Align.CENTER,
        });

        // Add the switch to the row
        row.add_suffix(toggle);
        row.activatable_widget = toggle;

        toggle.connect('notify::active', () => {
            on_toggle(entity, row, toggle.active);
        });

        return row;
    }

    static createTextRow(text) {
        return new Adw.ActionRow({
            title: text,
        });
    }

    destroy() {
        this.page = null;
        this.group = null;
        this.checkedListBox = null;
        this.unCheckedListBox = null;
    }

    applyDnD(list) {      
        // Iterate over ListBox children
        for (const row of list) {
            let drag_x;
            let drag_y;
        
            const drop_controller = new Gtk.DropControllerMotion();
        
            const drag_source = new Gtk.DragSource({
                actions: Gdk.DragAction.MOVE,
            });
        
            row.add_controller(drag_source);
            row.add_controller(drop_controller);
        
            // Drag handling
            drag_source.connect("prepare", (_source, x, y) => {
                drag_x = x;
                drag_y = y;
            
                const value = new GObject.Value();
                value.init(Gtk.ListBoxRow);
                value.set_object(row);
            
                return Gdk.ContentProvider.new_for_value(value);
            });
        
            drag_source.connect("drag-begin", (_source, drag) => {
                const drag_widget_clamp = new Adw.Clamp({
                    maximum_size: row.get_width(),
                  });
                const drag_widget = new Gtk.ListBox();

                drag_widget.set_size_request(row.get_width(), row.get_height());
                drag_widget.add_css_class("boxed-list");
                const drag_row = new Adw.ActionRow({ title: row.title });
                drag_row.add_prefix(
                    new Gtk.Image({
                        icon_name: "list-drag-handle-symbolic",
                        css_classes: ["dim-label"],
                    }),
                );
                drag_row.add_suffix(
                    new Gtk.CheckButton({
                        active: true,
                        valign: Gtk.Align.CENTER,
                    })
                );
                drag_widget.append(drag_row);
                
                drag_widget.drag_highlight_row(drag_row);

                // Clamp drag_widgets size to row width of underlying listbox
                drag_widget_clamp.set_child(drag_widget);
                
                const icon = Gtk.DragIcon.get_for_drag(drag);
                icon.child = drag_widget_clamp;
                drag.set_hotspot(drag_x, drag_y);
            });
        
            // Update row visuals during DnD operation
            drop_controller.connect("enter", () => {
            list.drag_highlight_row(row);
            });
        
            drop_controller.connect("leave", () => {
            list.drag_unhighlight_row();
            });
        }
      
        // Drop Handling
        this.drop_target.connect("drop", (_drop, value, _x, y) => {
            Utils._log("Drop!")
            const target_row = list.get_row_at_y(y);
            const target_index = target_row.get_index();
        
            // If value or the target row is null, do not accept the drop
            if (!value || !target_row) {
                return false;
            }            
            list.remove(value);
            list.insert(value, target_index);
            let sortedEntities = [];
            for (const row of list) {
                sortedEntities.push(row.getEntityId());
            }
            target_row.set_state_flags(Gtk.StateFlags.NORMAL, true);
            this._mscOptions.setEnabledByType(this.type, sortedEntities);
            Utils._log("%s",[this._mscOptions.getEnabledByType(this.type)]);
            // If everything is successful, return true to accept the drop
            return true;
        });
      }
    
      

}

export default class HassPrefs extends ExtensionPreferences  {
    // constructor(window) {
    // }

    fillPreferencesWindow(window) {
        this.window = window;
        this._settings = this.getSettings();
        this.window._settings = this._settings;
        this._mscOptions = new Settings.MscOptions(
            this.metadata,
            this.dir
        );

        this.togglablesPage = new SettingsPage("togglable", this.window, this._mscOptions);
        this.runnablesPage = new SettingsPage("runnable", this.window, this._mscOptions);
        this.sensorsPage = new SettingsPage("sensor", this.window, this._mscOptions);
        Utils.init(
            this.metadata.uuid,
            this._settings,
            this.metadata,
            this.dir,
            _
        );
        this.build();
        this.window.connect('close-request', () => {
            this._settings = null;
            this._mscOptions.destroy();
            this._mscOptions = null;
            this.togglablesPage.destroy();
            this.togglablesPage = null;
            this.runnablesPage.destroy();
            this.runnablesPage = null;
            this.sensorsPage.destroy();
            this.sensorsPage = null;
            Utils.disable();
        });
    }

    build() {
        this.buildGeneralSettingsPage();
        
        this.togglablesPage.build();
        this.runnablesPage.build();
        this.sensorsPage.build();

        // Enable search on settings
        this.window.search_enabled = true;
    }

    buildGeneralSettingsPage() {
        let page = new Adw.PreferencesPage({
            title: _('General Settings'),
            icon_name: "preferences-other-symbolic",
        });

        const general_group = new Adw.PreferencesGroup({ title: _('General Settings')});
        page.add(general_group);

        general_group.add(this.createStringSettingRow(Settings.HASS_URL));
        general_group.add(this.createAccessTokenSettingRow());
        general_group.add(this.createBooleanSettingRow(Settings.SHOW_NOTIFICATIONS_KEY));
        general_group.add(this.createBooleanSettingRow(Settings.DEBUG_MODE));

        const refresh_group = new Adw.PreferencesGroup({ title: _('Refresh sensors')});
        page.add(refresh_group);

        refresh_group.add(this.createBooleanSettingRow(Settings.DO_REFRESH));
        refresh_group.add(this.createStringSettingRow(Settings.REFRESH_RATE));

        const icon_group = new Adw.PreferencesGroup({ title: _('Panel Icon Options:')});
        page.add(icon_group);

        let validIcons = this._mscOptions.validIcons;
        let currentIcon = this._mscOptions.panelIcon;
        let iconGroup = new Gtk.CheckButton();
        for (let icon of validIcons) {
            icon_group.add(
              this.createIconRow(
                icon,
                icon == currentIcon,
                iconGroup,
                (icon) => {
                  this._mscOptions.panelIcon = icon;
                }
              )
            );
        }

        this.window.add(page);
    }

    createBooleanSettingRow(name) {
        let key = this._settings.settings_schema.get_key(name);
        let row = new Adw.ActionRow({
            title: _(key.get_summary()),
            subtitle: _(key.get_description()),
        });

        // Create a switch and bind its value to the `show-indicator` key
        let toggle = new Gtk.Switch({
            active: this._settings.get_boolean(name),
            valign: Gtk.Align.CENTER,
        });
        this._settings.bind(name, toggle, 'active', Gio.SettingsBindFlags.DEFAULT);

        // Add the switch to the row
        row.add_suffix(toggle);
        row.activatable_widget = toggle;

        return row;
    }

    createStringSettingRow(name) {
        let key = this._settings.settings_schema.get_key(name);
        let row = new Adw.EntryRow({
            title: _(key.get_summary()),
            text: this._settings.get_string(name),
            show_apply_button: true,
        });

        row.connect('apply', () => {
            this._settings.set_string(name, row.get_text())
        });

        return row;
    }

    createAccessTokenSettingRow() {
        let row = new Adw.PasswordEntryRow({
            title: _("Access Token"),
            show_apply_button: true,
        });

        row.connect('apply', () => {
          Utils._log('Access token changed: "%s"', [row.get_text()]);
          let new_value = row.get_text();
          if (!new_value) return;
          Secret.password_store(
              Utils.getTokenSchema(),
              {"token_string": "user_token"},
              Secret.COLLECTION_DEFAULT,
              "long_live_access_token",
              row.get_text(),
              null,
              (source, result) => {
                  Secret.password_store_finish(result);
                  // Always force reload entities cache in case of HASS Token change and invalidate it in case
                  // of error
                  Utils.getEntities(null, () => Utils.invalidateEntitiesCache(), true);
              }
          );
        });

        return row;
    }

    createIconRow(icon, checked,  icon_group, on_toggle) {
        let label = icon.split("/")[icon.split("/").length-1]
                    .split(".")[0]
                    .split("-")
                    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                    .join(" ");
        let row = new Adw.ActionRow({
            title: label,
        });

        // Create a switch and bind its value to the `show-indicator` key
        let toggle = new Gtk.CheckButton({
            active: checked,
            valign: Gtk.Align.CENTER,
            group: icon_group,
        });

        // Add the switch to the row
        row.add_suffix(toggle);
        row.activatable_widget = toggle;

        toggle.connect('notify::active', () => {
            on_toggle(icon, toggle.active);
        });

        return row;
    }
}
